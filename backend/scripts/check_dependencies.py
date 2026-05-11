#!/usr/bin/env python3
"""
Dependency checker for PDF processing scripts.
Validates that all required Python packages are installed.
"""
import sys
import json
from importlib.util import find_spec

REQUIRED_PACKAGES = {
    'cv2': 'opencv-python-headless',
    'numpy': 'numpy',
    'PIL': 'Pillow',
    'fitz': 'PyMuPDF',
}

def check_dependencies():
    """Check if all required packages are installed."""
    missing = []
    installed = []
    
    for import_name, package_name in REQUIRED_PACKAGES.items():
        try:
            spec = find_spec(import_name)
            if spec is None:
                missing.append(package_name)
            else:
                installed.append(package_name)
        except (ImportError, ModuleNotFoundError):
            missing.append(package_name)
    
    return {
        'success': len(missing) == 0,
        'installed': installed,
        'missing': missing,
        'install_command': f"pip install {' '.join(missing)}" if missing else None
    }

if __name__ == '__main__':
    result = check_dependencies()
    print(json.dumps(result, indent=2))
    sys.exit(0 if result['success'] else 1)
