# -*- mode: python ; coding: utf-8 -*-
"""PyInstaller spec for the VisionHarness desktop backend sidecar.

Build with:
    pyinstaller --noconfirm --clean packaging/visionharness-server.spec

The resulting binary is copied to web/src-tauri/binaries/ with the target-triple
suffix Tauri expects for external binaries.
"""

import os
import sys

from PyInstaller.utils.hooks import collect_all, collect_submodules

# PyInstaller executes specs via exec(), so __file__ is unavailable; SPECPATH is set.
ROOT = os.path.abspath(os.path.join(SPECPATH, ".."))
sys.path.insert(0, ROOT)

datas = []
binaries = []
hiddenimports = []

# Packages whose data files (model configs, YAMLs) are required at runtime.
for pkg in ("ultralytics", "supervision", "cv2"):
    try:
        d, b, h = collect_all(pkg)
        datas += d
        binaries += b
        hiddenimports += h
    except Exception as exc:  # pragma: no cover - build-time diagnostics
        print(f"[spec] could not collect {pkg}: {exc}")

# uvicorn resolves its loop/protocol implementations dynamically.
hiddenimports += collect_submodules("uvicorn")
hiddenimports += ["visionharness.server", "visionharness.desktop_server"]

a = Analysis(
    [os.path.join(ROOT, "visionharness", "desktop_server.py")],
    pathex=[ROOT],
    binaries=binaries,
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=[],
    runtime_hooks=[],
    excludes=["tkinter", "IPython", "pytest", "notebook"],
    noarchive=False,
)

pyz = PYZ(a.pure)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.datas,
    [],
    name="visionharness-server",
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=False,
    console=True,
    disable_windowed_traceback=False,
)
