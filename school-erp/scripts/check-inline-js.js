const fs=require('node:fs');
const vm=require('node:vm');
const html=fs.readFileSync('public/index.html','utf8');
const scripts=[...html.matchAll(/<script(?:\s[^>]*)?>([\s\S]*?)<\/script>/gi)]
  .map(m=>m[1].trim()).filter(Boolean);
if(!scripts.length)throw new Error('No inline JavaScript found in public/index.html');
scripts.forEach((source,index)=>new vm.Script(source,{filename:'public/index.html:inline-script-'+(index+1)}));
console.log('PASS: '+scripts.length+' inline script block(s) parse successfully.');
