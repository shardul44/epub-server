const { execSync } = require('child_process');
const path = require('path');
const backendDir = path.join(__dirname, '..');
const isWin = process.platform === 'win32';
const scriptPath = path.join(backendDir, 'scripts', isWin ? 'install-all.ps1' : 'install-all.sh');
const cmd = isWin
  ? `powershell -ExecutionPolicy Bypass -File "${scriptPath}"`
  : `bash "${scriptPath}"`;
execSync(cmd, { stdio: 'inherit', cwd: backendDir });
