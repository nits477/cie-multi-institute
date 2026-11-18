const fs=require('node:fs');
const vm=require('node:vm');
const pages=[
 'public/institute-admin-management.html',
 'public/master-admin.html',
 'public/institute-register.html',
 'public/institute-admin-login.html',
 'public/institute-admin-dashboard.html',
 'public/student-login.html'
];
let failures=0;
for(const file of pages){
 const html=fs.readFileSync(file,'utf8');
 const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)];
 if(!scripts.length){console.error('No inline script:',file);failures++;continue;}
 for(let i=0;i<scripts.length;i++){
  try{new vm.Script(scripts[i][1],{filename:file+'#script'+i});}
  catch(e){console.error(file+' inline script '+i+': '+e.message);failures++;}
 }
}
if(failures)process.exit(1);
console.log('Inline JavaScript syntax OK in '+pages.length+' HTML pages.');
