const assert=require('node:assert/strict');
const base=process.env.BASE_URL||'http://127.0.0.1:5001';
const secret=process.env.BOOTSTRAP_SECRET;
async function api(path,{method='GET',body,token,headers={}}={}){
  const response=await fetch(base+path,{method,headers:{...(body?{'Content-Type':'application/json'}:{}),...(token?{Authorization:'Bearer '+token}:{}),...headers},body:body?JSON.stringify(body):undefined});
  const data=await response.json().catch(()=>({}));
  return {status:response.status,data};
}
(async()=>{
  assert.ok(secret,'BOOTSTRAP_SECRET required for integration test');
  const boot=await api('/api/bootstrap/super-admin',{method:'POST',headers:{'x-bootstrap-secret':secret},body:{fullName:'CI Super Admin',email:'ci-super@example.test',password:'ci-super-password-123'}});
  assert.equal(boot.status,201,JSON.stringify(boot.data));
  const login=await api('/api/auth/login',{method:'POST',body:{email:'ci-super@example.test',password:'ci-super-password-123',role:'super_admin'}});
  assert.equal(login.status,200,JSON.stringify(login.data));
  const superToken=login.data.token;
  const a=await api('/api/super/schools',{method:'POST',token:superToken,body:{name:'Tenant A School',schoolCode:'TENANTA1'}});
  const b=await api('/api/super/schools',{method:'POST',token:superToken,body:{name:'Tenant B School',schoolCode:'TENANTB1'}});
  assert.equal(a.status,201,JSON.stringify(a.data));assert.equal(b.status,201,JSON.stringify(b.data));
  for(const [school,letter] of [[a.data,'a'],[b.data,'b']]){
    const r=await api('/api/super/schools/'+school.id+'/admins',{method:'POST',token:superToken,body:{fullName:'School Admin '+letter,email:'admin-'+letter+'@example.test',password:'school-admin-password-123'}});
    assert.equal(r.status,201,JSON.stringify(r.data));
  }
  const la=await api('/api/auth/login',{method:'POST',body:{email:'admin-a@example.test',password:'school-admin-password-123',role:'school_admin',schoolCode:'TENANTA1'}});
  const lb=await api('/api/auth/login',{method:'POST',body:{email:'admin-b@example.test',password:'school-admin-password-123',role:'school_admin',schoolCode:'TENANTB1'}});
  assert.equal(la.status,200,JSON.stringify(la.data));assert.equal(lb.status,200,JSON.stringify(lb.data));
  const add=await api('/api/school/admissions',{method:'POST',token:la.data.token,body:{studentName:'Student A',className:'Class 1',admissionNo:'A-001'}});
  assert.equal(add.status,201,JSON.stringify(add.data));
  const aList=await api('/api/school/admissions',{token:la.data.token});
  const bList=await api('/api/school/admissions',{token:lb.data.token});
  assert.equal(aList.status,200);assert.equal(aList.data.length,1,'School A must see its own admission');
  assert.equal(bList.status,200);assert.equal(bList.data.length,0,'School B must not see School A admission');
  const disabled=await api('/api/super/schools/'+b.data.id+'/modules',{method:'PATCH',token:superToken,body:{moduleKey:'fees',enabled:false}});
  assert.equal(disabled.status,200,JSON.stringify(disabled.data));
  const blocked=await api('/api/school/fees',{token:lb.data.token});
  assert.equal(blocked.status,403,'Disabled modules must be blocked by the API');
  const wrongLogin=await api('/api/auth/login',{method:'POST',body:{email:'admin-a@example.test',password:'school-admin-password-123',role:'school_admin',schoolCode:'TENANTB1'}});
  assert.equal(wrongLogin.status,401,'School Admin login must be scoped by School Code');
  console.log('PASS: Super Admin bootstrap; separate school admins; school-code login; school A/B data isolation; disabled module enforcement.');
})().catch(e=>{console.error(e);process.exit(1)});
