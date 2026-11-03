/* eslint-disable @typescript-eslint/no-require-imports */
// Build an exact source snapshot without production credentials or touching generated worktree files.
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),{execFileSync,spawnSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
const destination=fs.mkdtempSync(path.join(os.tmpdir(),'gymtools-private-contact-build-'));
const entries=execFileSync('git',['ls-files','--cached','--others','--exclude-standard','-z'],{cwd:root,encoding:'utf8',maxBuffer:30*1024*1024}).split('\0');
for(const item of new Set(entries)){
  if(!item||item.startsWith('.')&& !['.eslintrc.json','.gitignore'].includes(item))continue;
  if(item.startsWith('scripts/')||item.startsWith('docs/')||item.startsWith('supabase/'))continue;
  const input=path.resolve(root,item),output=path.resolve(destination,item);
  if(!input.startsWith(root+path.sep)||!output.startsWith(destination+path.sep)||!fs.existsSync(input)||!fs.statSync(input).isFile())continue;
  if(/(?:^|\/)\.env|\.log$|\.zip$|\.xlsx$|\.pdf$/i.test(item))continue;
  fs.mkdirSync(path.dirname(output),{recursive:true});fs.copyFileSync(input,output);
}
fs.symlinkSync(path.join(root,'node_modules'),path.join(destination,'node_modules'),'junction');
const env={...process.env,NEXT_TELEMETRY_DISABLED:'1'};
for(const key of Object.keys(env))if(/SUPABASE|SOLAPI|RESEND|TOSS|KAKAO|SERVICE_ROLE|CRON_SECRET|PAYMENT_SECRET|SMTP|GEMINI|GOOGLE_API_KEY|OPENAI|AI_GATEWAY|ONE_ON_ONE_INSTAGRAM/i.test(key))delete env[key];
env.NEXT_PUBLIC_SUPABASE_URL='http://127.0.0.1:1';env.NEXT_PUBLIC_SUPABASE_ANON_KEY='local-build-placeholder';
console.log('Isolated source build:',destination);
const r=spawnSync(process.execPath,[require.resolve('next/dist/bin/next'),'build','--webpack'],{cwd:destination,env,stdio:'inherit',timeout:300000});
if(r.error)console.error(r.error.message);process.exitCode=r.status??1;
