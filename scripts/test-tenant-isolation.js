const {Pool}=require('pg');
const assert=require('node:assert/strict');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.PGSSLMODE==='disable'?false:{rejectUnauthorized:false}});
const uid=Date.now().toString(36)+Math.random().toString(36).slice(2,7);
async function expectFkFailure(client,name,sql,params){
 await client.query('SAVEPOINT '+name);
 let failed=false;
 try{await client.query(sql,params)}catch(e){failed=e.code==='23503'||e.code==='23505'}
 await client.query('ROLLBACK TO SAVEPOINT '+name);
 assert.equal(failed,true,'Expected tenant/uniqueness constraint to reject '+name);
}
(async()=>{
 const c=await pool.connect();
 try{
  await c.query('BEGIN');
  const a=(await c.query("INSERT INTO institutes(institute_code,institute_name,status) VALUES($1,$2,'active') RETURNING id",['TSTA'+uid,'Tenant Test A'])).rows[0].id;
  const b=(await c.query("INSERT INTO institutes(institute_code,institute_name,status) VALUES($1,$2,'active') RETURNING id",['TSTB'+uid,'Tenant Test B'])).rows[0].id;
  const mobile='98'+uid.replace(/[^0-9]/g,'').padEnd(8,'1').slice(0,8);
  const sa=(await c.query('INSERT INTO students(name,father_name,mobile,institute_id) VALUES($1,$2,$3,$4) RETURNING id',['Student A','Father',mobile,a])).rows[0].id;
  const sb=(await c.query('INSERT INTO students(name,father_name,mobile,institute_id) VALUES($1,$2,$3,$4) RETURNING id',['Student B','Father',mobile,b])).rows[0].id;
  await expectFkFailure(c,'dup_mobile_a','INSERT INTO students(name,father_name,mobile,institute_id) VALUES($1,$2,$3,$4)',['Duplicate','Father',mobile,a]);
  const ea=(await c.query("INSERT INTO exams(name,institute_id,active) VALUES('Exam A',$1,true) RETURNING id",[a])).rows[0].id;
  const eb=(await c.query("INSERT INTO exams(name,institute_id,active) VALUES('Exam B',$1,true) RETURNING id",[b])).rows[0].id;
  const qa=(await c.query("INSERT INTO questions(question,option_a,option_b,option_c,option_d,answer,exam_id,institute_id) VALUES('Q?','A','B','C','D','A',$1,$2) RETURNING id",[ea,a])).rows[0].id;
  await c.query("INSERT INTO exam_sessions(token,student_id,exam_id,question_ids,institute_id) VALUES($1,$2,$3,'[]'::jsonb,$4)",['tokA'+uid,sa,ea,a]);
  await expectFkFailure(c,'cross_exam_session','INSERT INTO exam_sessions(token,student_id,exam_id,question_ids,institute_id) VALUES($1,$2,$3,$4::jsonb,$5)',['badS'+uid,sa,eb,'[]',a]);
  await c.query("INSERT INTO results(student_id,name,father_name,mobile,score,total,percentage,status,exam_id,institute_id) VALUES($1,'Student A','Father',$2,1,1,100,'PASS',$3,$4)",[sa,mobile,ea,a]);
  await expectFkFailure(c,'cross_result_exam',"INSERT INTO results(student_id,name,father_name,mobile,score,total,percentage,status,exam_id,institute_id) VALUES($1,'Student A','Father',$2,1,1,100,'PASS',$3,$4)",[sa,mobile,eb,a]);
  await c.query("INSERT INTO question_reports(student_id,exam_id,question_id,reason,institute_id) VALUES($1,$2,$3,'Test',$4)",[sa,ea,qa,a]);
  await expectFkFailure(c,'cross_question_report','INSERT INTO question_reports(student_id,exam_id,question_id,reason,institute_id) VALUES($1,$2,$3,$4,$5)',[sa,eb,qa,'bad',a]);
  await c.query("INSERT INTO wallet_transactions(student_id,amount,action,institute_id) VALUES($1,1,'Test',$2)",[sa,a]);
  await expectFkFailure(c,'cross_wallet','INSERT INTO wallet_transactions(student_id,amount,action,institute_id) VALUES($1,1,$2,$3)',[sa,'Test',b]);
  await c.query("INSERT INTO pin_reset_requests(student_id,mobile,institute_id) VALUES($1,$2,$3)",[sa,mobile,a]);
  await expectFkFailure(c,'cross_pin_reset','INSERT INTO pin_reset_requests(student_id,mobile,institute_id) VALUES($1,$2,$3)',[sa,mobile,b]);
  const ca=(await c.query('INSERT INTO old_paper_categories(name,institute_id) VALUES($1,$2) RETURNING id',['catA'+uid,a])).rows[0].id;
  const pa=(await c.query("INSERT INTO old_papers(category_id,title,pdf_data,file_name,institute_id) VALUES($1,'Paper',decode('00','hex'),'p.pdf',$2) RETURNING id",[ca,a])).rows[0].id;
  await expectFkFailure(c,'cross_paper_order','INSERT INTO old_paper_orders(paper_id,customer_name,mobile,address,pincode,institute_id) VALUES($1,$2,$3,$4,$5,$6)',[pa,'Test',mobile,'Address','248001',b]);
  await c.query('ROLLBACK');
  console.log('PASS: same mobile allowed across institutes; duplicate within institute blocked; cross-tenant sessions, results, reports, wallet, PIN reset and old-paper orders rejected.');
 }catch(e){await c.query('ROLLBACK').catch(()=>{});console.error(e);process.exitCode=1}
 finally{c.release();await pool.end()}
})();
