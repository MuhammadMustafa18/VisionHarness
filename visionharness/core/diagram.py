"""Editorial SVG Diagram Generator for Vision Workflows.
Implements the Diagram Design system (cathrynlavery/diagram-design):
- 4px grid coordinates
- 1px hairline strokes
- Clean typographical hierarchy (Google Sans / Mono)
- No shadows or Mermaid artifacts
- Self-contained inline SVG matching the Obsidian / Ember dark palette
"""

from typing import Dict, Any, List


def generate_pipeline_svg(spec: Dict[str, Any], width: int = 760, height: int = 180) -> str:
    """Generates an editorial SVG data flow diagram for a CV workflow spec."""
    detector_name = spec.get("detector", {}).get("model", "YOLO11 Nano")
    classes = ", ".join(spec.get("detector", {}).get("classes", ["person"]))
    tracker_name = spec.get("tracker", {}).get("tracker_type", "ByteTrack").capitalize()
    
    # Stages to render on a strict 4px grid
    stages = [
        {"num": "01", "role": "Ingestion", "title": "Video Stream", "meta": "RTSP / MP4", "accent": False},
        {"num": "02", "role": "Inference", "title": detector_name, "meta": f"Filter: {classes}", "accent": True},
        {"num": "03", "role": "Association", "title": tracker_name, "meta": "Trajectory & IDs", "accent": False},
        {"num": "04", "role": "Spatial Logic", "title": "Line Crossing", "meta": "Vector IN / OUT", "accent": False},
        {"num": "05", "role": "Telemetry", "title": "Analytics HUD", "meta": "Live Tally & Video", "accent": False},
    ]

    box_w = 124
    box_h = 88
    gap = 28
    start_x = 20
    start_y = 44

    svg_nodes = []
    svg_connectors = []

    for i, st in enumerate(stages):
        x = start_x + i * (box_w + gap)
        y = start_y
        
        # Border & fill styling
        border_color = "#3b82f6" if st["accent"] else "#202228"
        bg_color = "#161922" if st["accent"] else "#121317"
        num_color = "#60a5fa" if st["accent"] else "#52525b"
        title_color = "#ffffff" if st["accent"] else "#ededef"
        meta_color = "#93c5fd" if st["accent"] else "#71717a"

        # Node card on 4px grid
        node_xml = f"""
        <!-- Node {st['num']} -->
        <g transform="translate({x}, {y})">
          <rect width="{box_w}" height="{box_h}" rx="8" fill="{bg_color}" stroke="{border_color}" stroke-width="1" />
          <text x="12" y="22" font-family="'Google Sans Code', monospace" font-size="9" font-weight="600" fill="{num_color}">{st['num']} · {st['role'].upper()}</text>
          <text x="12" y="46" font-family="'Google Sans', sans-serif" font-size="12" font-weight="600" fill="{title_color}">{st['title']}</text>
          <text x="12" y="66" font-family="'Google Sans Text', sans-serif" font-size="10" fill="{meta_color}">{st['meta']}</text>
        </g>
        """
        svg_nodes.append(node_xml)

        # Connector arrow to next stage
        if i < len(stages) - 1:
            cx1 = x + box_w
            cy = y + (box_h // 2)
            cx2 = cx1 + gap
            connector_xml = f"""
            <!-- Arrow {i} -> {i+1} -->
            <path d="M {cx1} {cy} L {cx2 - 4} {cy}" stroke="#2a2d36" stroke-width="1.5" stroke-linecap="round" />
            <polygon points="{cx2 - 4},{cy - 3} {cx2},{cy} {cx2 - 4},{cy + 3}" fill="#3b3f4d" />
            """
            svg_connectors.append(connector_xml)

    return f"""<svg viewBox="0 0 {width} {height}" width="100%" height="100%" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Computer Vision Pipeline Architecture Diagram">
      <defs>
        <style>
          text {{ font-smooth: always; -webkit-font-smoothing: antialiased; }}
        </style>
      </defs>
      <rect width="100%" height="100%" fill="#0a0b0d" rx="12" stroke="#191a1f" stroke-width="1" />
      
      <!-- Header Label -->
      <text x="20" y="24" font-family="'Google Sans', sans-serif" font-size="11" font-weight="500" fill="#71717a">PIPELINE TOPOLOGY · DIRECTIONAL DATA FLOW</text>
      
      <!-- Connectors -->
      {''.join(svg_connectors)}
      
      <!-- Nodes -->
      {''.join(svg_nodes)}
    </svg>"""
