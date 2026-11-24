"""LAN Camera Discovery (ONVIF WS-Discovery + Port Scan) & Brand-Aware RTSP Probing."""

import os
import re
import socket
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed
from typing import Any, Dict, List, Optional
from urllib.parse import quote

import cv2

BRAND_PATHS: Dict[str, List[str]] = {
    "hikvision": [
        "rtsp://{auth}{ip}:554/Streaming/Channels/101",
        "rtsp://{auth}{ip}:554/Streaming/Channels/102",
        "rtsp://{auth}{ip}:554/h264/ch1/main/av_stream",
    ],
    "dahua": [
        "rtsp://{auth}{ip}:554/cam/realmonitor?channel=1&subtype=0",
        "rtsp://{auth}{ip}:554/cam/realmonitor?channel=1&subtype=1",
    ],
    "tapo": [
        "rtsp://{auth}{ip}:554/stream1",
        "rtsp://{auth}{ip}:554/stream2",
    ],
    "reolink": [
        "rtsp://{auth}{ip}:554/h264Preview_01_main",
        "rtsp://{auth}{ip}:554/h264Preview_01_sub",
    ],
    "ipwebcam": [
        "http://{auth}{ip}:8080/video",
        "http://{auth}{ip}:8080/videofeed",
    ],
    "generic": [
        "rtsp://{auth}{ip}:554/stream1",
        "rtsp://{auth}{ip}:554/live",
        "rtsp://{auth}{ip}:554/Streaming/Channels/101",
        "rtsp://{auth}{ip}:554/cam/realmonitor?channel=1&subtype=0",
        "rtsp://{auth}{ip}:554/h264Preview_01_main",
        "rtsp://{auth}{ip}:8554/live",
        "http://{auth}{ip}:8080/video",
    ],
}

WS_DISCOVERY_PROBE = """<?xml version="1.0" encoding="UTF-8"?>
<e:Envelope xmlns:e="http://www.w3.org/2003/05/soap-envelope"
            xmlns:w="http://schemas.xmlsoap.org/ws/2004/08/addressing"
            xmlns:d="http://schemas.xmlsoap.org/ws/2005/04/discovery"
            xmlns:dn="http://www.onvif.org/ver10/network/wsdl">
  <e:Header>
    <w:MessageID>uuid:{msg_id}</w:MessageID>
    <w:To e:mustUnderstand="true">urn:schemas-xmlsoap-org:ws:2005:04:discovery</w:To>
    <w:Action a:mustUnderstand="true" xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">http://schemas.xmlsoap.org/ws/2005/04/discovery/Probe</w:Action>
  </e:Header>
  <e:Body>
    <d:Probe>
      <d:Types>dn:NetworkVideoTransmitter</d:Types>
    </d:Probe>
  </e:Body>
</e:Envelope>"""


def _get_local_ip() -> Optional[str]:
    try:
        s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
        s.connect(("8.8.8.8", 80))
        ip = s.getsockname()[0]
        s.close()
        return ip
    except Exception:
        return None


def _onvif_ws_discover(timeout_sec: float = 1.8) -> Dict[str, Dict[str, Any]]:
    found: Dict[str, Dict[str, Any]] = {}
    sock = socket.socket(socket.AF_INET, socket.SOCK_DGRAM, socket.IPPROTO_UDP)
    sock.setsockopt(socket.IPPROTO_IP, socket.IP_MULTICAST_TTL, 2)
    sock.settimeout(timeout_sec)
    payload = WS_DISCOVERY_PROBE.format(msg_id=uuid.uuid4()).encode("utf-8")
    try:
        sock.sendto(payload, ("239.255.255.250", 3702))
        while True:
            try:
                data, addr = sock.recvfrom(65535)
                ip = addr[0]
                text = data.decode("utf-8", errors="ignore")
                xaddrs = re.findall(r"<[^:>]*XAddrs[^>]*>([^<]+)</", text)
                scopes = re.findall(r"<[^:>]*Scopes[^>]*>([^<]+)</", text)
                hint = "onvif"
                scope_str = " ".join(scopes).lower()
                for b in ("hikvision", "dahua", "tapo", "reolink", "axis", "ezviz"):
                    if b in scope_str:
                        hint = b
                        break
                found[ip] = {
                    "ip": ip,
                    "source": "onvif",
                    "brand_hint": hint,
                    "onvif_xaddrs": xaddrs,
                    "ports": [554],
                }
            except socket.timeout:
                break
    except Exception:
        pass
    finally:
        sock.close()
    return found


def _check_port(ip: str, port: int, timeout: float = 0.25) -> bool:
    s = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
    s.settimeout(timeout)
    try:
        return s.connect_ex((ip, port)) == 0
    except Exception:
        return False
    finally:
        s.close()


def discover_lan_cameras(timeout_sec: float = 1.8, scan_subnet: bool = True) -> Dict[str, Any]:
    """Discover ONVIF and RTSP/HTTP cameras on the local network."""
    local_ip = _get_local_ip()
    cameras = _onvif_ws_discover(timeout_sec=timeout_sec)

    if scan_subnet and local_ip and "." in local_ip:
        prefix = ".".join(local_ip.split(".")[:3])
        ports = (554, 8080, 8554)
        targets = [(f"{prefix}.{i}", p) for i in range(1, 255) for p in ports if f"{prefix}.{i}" != local_ip]

        with ThreadPoolExecutor(max_workers=64) as pool:
            futs = {pool.submit(_check_port, ip, port): (ip, port) for ip, port in targets}
            for fut in as_completed(futs):
                ip, port = futs[fut]
                if fut.result():
                    entry = cameras.setdefault(
                        ip,
                        {
                            "ip": ip,
                            "source": "port_scan",
                            "brand_hint": "ipwebcam" if port == 8080 else "generic",
                            "ports": [],
                        },
                    )
                    if port not in entry["ports"]:
                        entry["ports"].append(port)

    return {
        "status": "success",
        "local_ip": local_ip,
        "count": len(cameras),
        "cameras": sorted(cameras.values(), key=lambda c: c["ip"]),
    }


def build_candidate_urls(ip: str, username: str = "", password: str = "", brand: str = "auto") -> List[str]:
    """Generate ordered candidate RTSP/HTTP URLs for a camera IP and optional brand."""
    auth = ""
    if username:
        u = quote(username, safe="")
        p = quote(password or "", safe="")
        auth = f"{u}:{p}@"

    b = (brand or "auto").lower().strip()
    templates = BRAND_PATHS.get(b, BRAND_PATHS["generic"]) if b != "auto" else BRAND_PATHS["generic"]
    return [t.format(auth=auth, ip=ip.strip()) for t in templates]


def probe_camera_url(url: str) -> bool:
    """Test if a candidate RTSP/HTTP URL yields a readable video frame."""
    os.environ.setdefault("OPENCV_FFMPEG_CAPTURE_OPTIONS", "rtsp_transport;tcp")
    cap = cv2.VideoCapture(url)
    if not cap.isOpened():
        cap.release()
        return False
    ok, frame = cap.read()
    cap.release()
    return bool(ok and frame is not None)
