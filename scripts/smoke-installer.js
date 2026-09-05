'use strict';
// Run only on a disposable Windows CI runner: the product's NSIS registration must
// never be replaced on a developer's workstation merely to test an installer.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync, spawn } = require('node:child_process');
const { _electron: electron } = require('playwright');

const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const quote = value => "'" + String(value).replace(/'/g, "''") + "'";
function runInstaller(executable, args) {
  const command = `$ErrorActionPreference = 'Stop'\n$p = Start-Process -FilePath ${quote(executable)} -ArgumentList @(${args.map(quote).join(',')}) -WindowStyle Hidden -Wait -PassThru\nexit $p.ExitCode`;
  execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command], { stdio:'inherit', timeout:120000 });
}
async function main() {
  if (process.platform !== 'win32' || process.env.CI !== 'true') throw new Error('Installer smoke requires a disposable Windows CI runner');
  const pkg = require('../package.json');
  const workspace = path.resolve(__dirname,'..');
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'spp-installer-smoke-'));
  const install = path.join(root,'App');
  const data = path.join(root,'Data');
  fs.mkdirSync(data);
  fs.writeFileSync(path.join(data,'settings.json'), '{}');
  const marker=path.join(data,'keep-user-data.txt');
  fs.writeFileSync(marker,'retain after uninstall');
  let app;
  try {
    runInstaller(path.join(workspace,'dist',`Star-Picking-Pavilion-Setup-${pkg.version}.exe`), ['/S','/currentuser',`/D=${install}`]);
    const executablePath=path.join(install,'Star-Picking-Pavilion.exe');
    if (!fs.existsSync(executablePath)) throw new Error('Installer did not create application executable');
    const env={...process.env,STAR_PICKING_PAVILION_TEST_DATA_DIR:data,STAR_PICKING_PAVILION_NO_SCHEDULER:'1',STAR_PICKING_PAVILION_DISABLE_AUTO_UPDATE:'1'};
    app=await electron.launch({executablePath,args:['--hidden'],env,timeout:30000});
    const page=await app.firstWindow();
    await page.waitForSelector('.nav');
    const version=await app.evaluate(({app})=>app.getVersion());
    if (version !== pkg.version) throw new Error(`Installed app version ${version} differs from ${pkg.version}`);
    const second=spawn(executablePath,['--hidden'],{env,windowsHide:true,stdio:'ignore'});
    const exit=await new Promise((resolve,reject)=>{
      const timer=setTimeout(()=>{second.kill();reject(new Error('Second instance did not exit'));},10000);
      second.once('error',e=>{clearTimeout(timer);reject(e);});
      second.once('exit',code=>{clearTimeout(timer);resolve(code);});
    });
    if (exit !== 0) throw new Error(`Second instance exit code ${exit}`);
    await app.close(); app=null;
    runInstaller(path.join(install,'Uninstall Star-Picking-Pavilion.exe'), ['/S','/currentuser']);
    const deadline=Date.now()+30000;
    while(fs.existsSync(executablePath) && Date.now()<deadline) await wait(250);
    if(fs.existsSync(executablePath)) throw new Error('Uninstall did not remove installed executable');
    if(fs.readFileSync(marker,'utf8')!=='retain after uninstall') throw new Error('Uninstall removed user data');
    console.log(`Installed, launched, checked single-instance, closed and uninstalled v${version}; user data retained.`);
  } finally {
    if(app) await app.close().catch(()=>{});
    const resolved=path.resolve(root), temporary=path.resolve(os.tmpdir())+path.sep;
    if(!resolved.startsWith(temporary) || !path.basename(resolved).startsWith('spp-installer-smoke-')) throw new Error('Unsafe smoke cleanup path');
    fs.rmSync(resolved,{recursive:true,force:true,maxRetries:10,retryDelay:500});
  }
}
main().catch(error=>{console.error(error.message);process.exitCode=1;});
