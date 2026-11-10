/* Budget Monitor – browser-side logic: state, API calls, rendering, event listeners */
let S={target:90,funds:[],recs:[]};
/* ===== Auth state (session is an HttpOnly cookie set by the server) ===== */
const AUTH={me:{admin:false}};
const $=id=>document.getElementById(id);
function sync(t){const e=$('sync');if(e)e.textContent=t}
function showError(msg){const e=$('err');e.textContent=msg||'';e.classList.toggle('hide',!msg)}

/* ===== API layer: fetch to the Netlify Function (/api/<action>) ===== */
async function api(fn,...args){
  const r=await fetch('/api/'+fn,{method:'POST',credentials:'same-origin',headers:{'Content-Type':'application/json','X-Requested-With':'bm'},body:JSON.stringify(args)});
  let j;try{j=await r.json()}catch(e){throw new Error('Server error ('+r.status+')')}
  if(!j.ok)throw new Error(j.error||'Request failed');
  return j.data;
}
function load(quiet){
  if(!quiet)sync('Loading…');
  return api('getData')
    .then(d=>{S=d;AUTH.me=d.me||{admin:false};$('target').value=S.target;renderAll();applyAuth();showError('');sync('Synced')})
    .catch(e=>{sync('Load failed');showError('Could not load data: '+e.message)});
}
let pending=0;
function save(fn,arg){   // optimistic UI: local state is already updated; roll back by reloading on failure
  pending++;sync('Saving…');
  return api(fn,arg)
    .then(()=>{showError('');if(pending===1)sync('Saved')})
    .catch(e=>{showError('Save failed: '+e.message+' (data reloaded from the sheet)');return load(true)})
    .finally(()=>{pending--});
}
const debounce=(fn,ms)=>{let t;return(...a)=>{clearTimeout(t);t=setTimeout(()=>fn(...a),ms)}};
const esc=s=>String(s??'').replace(/[&<>"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[c]));
const peso=n=>new Intl.NumberFormat('en-PH',{style:'currency',currency:'PHP',maximumFractionDigits:0}).format(n||0);
const pct=(a,b)=>b>0?a/b*100:0;
const fmtp=p=>p.toFixed(1)+'%';
let editId=null;

function status(rate){
  const t=+$('target').value||0;
  if(rate>=t)return['ok','On target'];
  if(rate>=t-15)return['warn','Watch'];
  return['bad','Behind'];
}
function totals(rs){
  const t=rs.reduce((a,r)=>({allot:a.allot+r.allot,oblig:a.oblig+r.oblig,disb:a.disb+r.disb}),{allot:0,oblig:0,disb:0});
  t.unobl=t.allot-t.oblig;t.unpaid=t.oblig-t.disb;t.or=pct(t.oblig,t.allot);t.dr=pct(t.disb,t.oblig);return t;
}
const bar=(p,cls)=>`<div class="bar"><i class="${cls}" style="width:${Math.min(100,p)}%"></i></div>`;
const fundName=c=>(S.funds.find(f=>f.code===c)||{name:'Unknown'}).name;

function summaryRows(groups,label){
  let h=`<tr><th>${label}</th><th class="n">Allotment</th><th class="n">Obligations</th><th class="n">Unobligated</th><th class="n">Disbursements</th><th class="n">Unpaid Oblig.</th><th>Obligation rate</th><th class="n">Disb. rate</th><th>Status</th></tr>`;
  groups.forEach(g=>{
    const t=totals(g.rows),[c,l]=status(t.or);
    h+=`<tr><td>${g.label}</td><td class="n">${peso(t.allot)}</td><td class="n">${peso(t.oblig)}</td><td class="n">${peso(t.unobl)}</td><td class="n">${peso(t.disb)}</td><td class="n">${peso(t.unpaid)}</td><td>${bar(t.or,c)}<span class="sub">${fmtp(t.or)}</span></td><td class="n">${fmtp(t.dr)}</td><td><span class="pill ${c}">${l}</span></td></tr>`;
  });
  return h;
}
let DQ='',DF='';
const p2=n=>String(n).padStart(2,'0');
const MN=['January','February','March','April','May','June','July','August','September','October','November','December'];
const mkP=()=>{const d=new Date();return{type:'all',year:d.getFullYear(),q:Math.floor(d.getMonth()/3)+1,m:d.getMonth()+1,from:'',to:''}};
let P=mkP();
function periodRange(){
  const y=P.year;
  if(P.type==='year')return[`${y}-01-01`,`${y}-12-31`];
  if(P.type==='quarter'){const e=P.q*3;return[`${y}-${p2(e-2)}-01`,`${y}-${p2(e)}-${p2(new Date(y,e,0).getDate())}`]}
  if(P.type==='month')return[`${y}-${p2(P.m)}-01`,`${y}-${p2(P.m)}-${p2(new Date(y,P.m,0).getDate())}`];
  if(P.type==='range')return[P.from||'0000-00-00',P.to||'9999-99-99'];
  return null;
}
function periodLabel(){
  if(P.type==='year')return`Year ${P.year}`;
  if(P.type==='quarter')return`Q${P.q} ${P.year}`;
  if(P.type==='month')return`${MN[P.m-1]} ${P.year}`;
  if(P.type==='range')return`${P.from||'start'} to ${P.to||'latest'}`;
  return'All periods';
}
function fillYears(){
  const ys=new Set([new Date().getFullYear()]);
  S.recs.forEach(r=>{const y=+String(r.date||'').slice(0,4);if(y)ys.add(y)});
  const arr=[...ys].sort((a,b)=>b-a);
  $('d_year').innerHTML=arr.map(y=>`<option>${y}</option>`).join('');
  if(!arr.includes(P.year))P.year=arr[0];
  $('d_year').value=P.year;
}
function periodUI(){
  const t=P.type,sh=(id,on)=>$(id).classList.toggle('hide',!on);
  sh('w_year',['year','quarter','month'].includes(t));sh('w_q',t==='quarter');sh('w_m',t==='month');sh('w_from',t==='range');sh('w_to',t==='range');
  $('d_per').value=t;$('d_q').value=P.q;$('d_m').value=P.m;$('d_from').value=P.from;$('d_to').value=P.to;
}
function dashView(){
  const q=DQ.trim().toLowerCase();
  const pr=periodRange();
  const recs=S.recs.filter(r=>(!DF||r.fund===DF)&&(!pr||(r.date&&r.date>=pr[0]&&r.date<=pr[1]))&&(!q||[r.fund,fundName(r.fund),r.uacs,r.desc,r.pap,r.office,r.cls].join(' ').toLowerCase().includes(q)));
  const funds=S.funds.filter(f=>(!DF||f.code===DF)&&(!(q||pr)||recs.some(r=>r.fund===f.code)));
  return{recs,funds,total:S.recs.length};
}
function renderDash(){
  const V=dashView();
  const filt=DQ.trim()||DF||P.type!=='all';
  $('dInfo').textContent=(filt?`Showing ${V.recs.length} of ${V.total} records across ${V.funds.length} fund source(s). KPIs, charts and tables reflect the filtered results.`:`Showing all ${V.total} records across ${V.funds.length} fund source(s).`)+` Obligation period: ${periodLabel()}.`;
  const S={funds:V.funds,recs:V.recs}; // filtered view used by the dashboard only
  const t=totals(S.recs),[c,l]=status(t.or);
  $('kpis').innerHTML=[
    ['Total allotment',peso(t.allot)],['Obligations',peso(t.oblig)],['Unobligated allotment',peso(t.unobl)],
    ['Disbursements',peso(t.disb)],['Unpaid obligations',peso(t.unpaid)],
    ['Obligation rate',`${fmtp(t.or)} <span class="pill ${c}">${l}</span>`],['Disbursement rate',fmtp(t.dr)]
  ].map(k=>`<div class="kpi"><span class="sub">${k[0]}</span><b>${k[1]}</b></div>`).join('');
  $('fundTbl').innerHTML=summaryRows(S.funds.map(f=>({label:`<b>${esc(f.code)}</b><br><span class="sub">${esc(f.name)}</span>`,rows:S.recs.filter(r=>r.fund===f.code)})),'Fund source');
  $('classTbl').innerHTML=summaryRows(['PS','MOOE','CO'].map(k=>({label:k,rows:S.recs.filter(r=>r.cls===k)})),'Expense class');
  renderPies();
}
const PAL=['#0b6e4f','#2e86c1','#c98a00','#8e44ad','#c0392b','#16a085','#d35400','#7f8c8d'];
function pie(sl){
  const tot=sl.reduce((a,s)=>a+s.v,0);
  if(tot<=0)return '<div class="sub">No data</div>';
  let a0=-Math.PI/2,p='';
  sl.filter(s=>s.v>0).forEach(s=>{
    const f=s.v/tot,a1=a0+f*2*Math.PI,tt=`<title>${esc(s.l)}: ${peso(s.v)} (${fmtp(f*100)})</title>`;
    if(f>0.9999)p+=`<circle cx="60" cy="60" r="56" style="fill:${s.c}">${tt}</circle>`;
    else{const x0=60+56*Math.cos(a0),y0=60+56*Math.sin(a0),x1=60+56*Math.cos(a1),y1=60+56*Math.sin(a1);
      p+=`<path d="M60 60L${x0.toFixed(2)} ${y0.toFixed(2)}A56 56 0 ${f>.5?1:0} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}Z" style="fill:${s.c};stroke:var(--card);stroke-width:1.5">${tt}</path>`}
    a0=a1;
  });
  const leg=sl.map(s=>`<div><i style="background:${s.c}"></i>${esc(s.l)}: ${peso(s.v)} (${fmtp(s.v/tot*100)})</div>`).join('');
  return `<div class="pie"><svg viewBox="0 0 120 120" width="130" height="130" role="img">${p}</svg><div class="leg">${leg}</div></div>`;
}
function renderPies(){
  const V=dashView(),S={funds:V.funds,recs:V.recs}; // filtered view
  const st=rs=>{const t=totals(rs);return [{l:'Disbursed',v:t.disb,c:'var(--ok)'},{l:'Unpaid obligations',v:t.unpaid,c:'var(--warn)'},{l:'Unobligated',v:t.unobl,c:'var(--mut)'}]};
  const card=(title,sub,rs)=>{const t=totals(rs),[c,l]=status(t.or);
    return `<div class="card"><h2>${title}</h2>${sub?`<div class="sub">${sub}</div>`:''}<div style="margin:6px 0 10px">Obligation rate <b>${fmtp(t.or)}</b> <span class="pill ${c}">${l}</span> · Allotment ${peso(t.allot)}</div>${pie(st(rs))}</div>`};
  $('pies1').innerHTML=card('Overall','All fund sources',S.recs)+
    `<div class="card"><h2>Allotment share by fund source</h2><div class="sub">Share of total allotment</div><div style="margin:6px 0 10px">&nbsp;</div>${pie(S.funds.map((f,i)=>({l:f.code,v:totals(S.recs.filter(r=>r.fund===f.code)).allot,c:PAL[i%PAL.length]})))}</div>`;
  $('pies2').innerHTML=S.funds.map(f=>card(esc(f.code),esc(f.name),S.recs.filter(r=>r.fund===f.code))).join('')||'<div class="sub">No fund sources.</div>';
  $('pies3').innerHTML=['PS','MOOE','CO'].map(k=>card(k,'',S.recs.filter(r=>r.cls===k))).join('');
}
function fillFundSelects(){
  const opts=S.funds.map(f=>`<option value="${esc(f.code)}">${esc(f.code)} – ${esc(f.name)}</option>`).join('');
  const cur=$('q_fund').value;
  $('f_fund').innerHTML=opts;
  $('q_fund').innerHTML='<option value="">All fund sources</option>'+opts;
  $('q_fund').value=cur;
  const dcur=DF;
  $('d_fund').innerHTML='<option value="">All fund sources</option>'+opts;
  if(S.funds.some(f=>f.code===dcur))$('d_fund').value=dcur;else DF='';
}
function renderRecs(){
  const fq=$('q_fund').value,tq=$('q_txt').value.toLowerCase();
  const rows=S.recs.filter(r=>(!fq||r.fund===fq)&&(!tq||[r.uacs,r.desc,r.pap,r.office].join(' ').toLowerCase().includes(tq)));
  let h='<tr><th>Fund</th><th>UACS</th><th>Description</th><th>Class</th><th>PAP</th><th>Unit</th><th>Date</th><th class="n">Allotment</th><th class="n">Obligations</th><th class="n">Disbursed</th><th>Obl. rate</th><th class="admin-only"></th></tr>';
  rows.forEach(r=>{const p=pct(r.oblig,r.allot),[c]=status(p);
    h+=`<tr><td>${esc(r.fund)}</td><td>${esc(r.uacs)}</td><td>${esc(r.desc)}</td><td>${r.cls}</td><td>${esc(r.pap)}</td><td>${esc(r.office)}</td><td>${esc(r.date||'')}</td><td class="n">${peso(r.allot)}</td><td class="n">${peso(r.oblig)}</td><td class="n">${peso(r.disb)}</td><td>${bar(p,c)}<span class="sub">${fmtp(p)}</span></td><td class="admin-only"><button class="lnk" data-e="${r.id}">Edit</button><button class="lnk" data-d="${r.id}">Delete</button></td></tr>`});
  if(!rows.length)h+='<tr><td colspan="12" class="sub">No records.</td></tr>';
  $('recTbl').innerHTML=h;
}
function renderFunds(){
  let h='<tr><th>Code</th><th>Description</th><th class="n">Records</th><th class="admin-only"></th></tr>';
  S.funds.forEach(f=>{h+=`<tr><td>${esc(f.code)}</td><td>${esc(f.name)}</td><td class="n">${S.recs.filter(r=>r.fund===f.code).length}</td><td class="admin-only"><button class="lnk" data-df="${esc(f.code)}">Remove</button></td></tr>`});
  $('fundList').innerHTML=h;
}
function renderAll(){fillYears();fillFundSelects();renderDash();renderRecs();renderFunds()}

const ids=['fund','uacs','desc','cls','pap','office','allot','oblig','disb','date'];
function clearForm(){ids.forEach(i=>{if(i!=='fund'&&i!=='cls')$('f_'+i).value=''});editId=null;$('formTitle').textContent='Add allotment / obligation record';$('cancel').classList.add('hide');$('msg').textContent=''}
$('save').onclick=()=>{
  const r={fund:$('f_fund').value,uacs:$('f_uacs').value.trim(),desc:$('f_desc').value.trim(),cls:$('f_cls').value,pap:$('f_pap').value.trim(),office:$('f_office').value.trim(),allot:+$('f_allot').value||0,oblig:+$('f_oblig').value||0,disb:+$('f_disb').value||0,date:$('f_date').value};
  let m='';
  if(!r.fund)m='Add a fund source first.';
  else if(!/^\d{10}$/.test(r.uacs))m='UACS object code must be 10 digits.';
  else if(!r.desc)m='Enter an object description.';
  else if(!r.date)m='Select the obligation date.';
  else if(r.oblig>r.allot)m='Obligations cannot exceed the allotment.';
  else if(r.disb>r.oblig)m='Disbursements cannot exceed obligations.';
  $('msg').textContent=m;if(m)return;
  let rec;if(editId){rec=S.recs.find(x=>x.id===editId);Object.assign(rec,r)}else{r.id=Date.now();S.recs.push(r);rec=r}
  save('upsertRecord',rec);clearForm();renderAll();
};
$('cancel').onclick=clearForm;
$('recTbl').onclick=e=>{
  const ed=e.target.dataset.e,del=e.target.dataset.d;
  if(ed){const r=S.recs.find(x=>x.id==ed);editId=r.id;ids.forEach(i=>$('f_'+i).value=r[i]);$('formTitle').textContent='Edit record';$('cancel').classList.remove('hide');scrollTo(0,0)}
  if(del&&confirm('Delete this record?')){S.recs=S.recs.filter(x=>x.id!=del);save('deleteRecord',del);renderAll()}
};
$('addFund').onclick=()=>{
  const code=$('n_code').value.trim(),name=$('n_name').value.trim();
  let m=!/^\d{8}$/.test(code)?'Fund source code must be 8 digits.':!name?'Enter a description.':S.funds.some(f=>f.code===code)?'Code already exists.':'';
  $('fmsg').textContent=m;if(m)return;
  const nf={code,name};S.funds.push(nf);$('n_code').value=$('n_name').value='';save('addFund',nf);renderAll();
};
$('fundList').onclick=e=>{
  const c=e.target.dataset.df;if(!c)return;
  if(S.recs.some(r=>r.fund===c)){alert('This fund source still has records. Delete them first.');return}
  S.funds=S.funds.filter(f=>f.code!==c);save('deleteFund',c);renderAll();
};
$('reset').onclick=()=>{if(confirm('Replace all data with sample data?')){sync('Resetting…');api('resetSample').then(()=>load()).catch(e=>showError('Reset failed: '+e.message))}};
let tt;$('target').oninput=()=>{S.target=+$('target').value;clearTimeout(tt);tt=setTimeout(()=>{if(AUTH.me.admin)save('setTarget',S.target)},600);renderDash();renderRecs()};
$('q_fund').onchange=renderRecs;$('q_txt').oninput=renderRecs;
$('d_txt').oninput=debounce(()=>{DQ=$('d_txt').value;renderDash()},150);
$('d_fund').onchange=()=>{DF=$('d_fund').value;renderDash()};
$('d_clear').onclick=()=>{DQ='';DF='';P=mkP();$('d_txt').value='';$('d_fund').value='';fillYears();periodUI();renderDash()};
[['d_per','type'],['d_year','year'],['d_q','q'],['d_m','m'],['d_from','from'],['d_to','to']].forEach(([id,k])=>{
  $(id).onchange=()=>{P[k]=['year','q','m'].includes(k)?+$(id).value:$(id).value;periodUI();renderDash()};
});
periodUI();
$('tabs').onclick=e=>{const t=e.target.dataset.t;if(!t)return;
  $('tabs').classList.remove('open');$('menuBtn').setAttribute('aria-expanded','false');$('menuLabel').textContent=e.target.textContent;
  ['dash','recs','funds','admin'].forEach(k=>$(k).classList.toggle('hide',k!==t));
  if(t==='admin')refreshAdminLists();
  [...$('tabs').children].forEach(b=>b.classList.toggle('on',b.dataset.t===t));
};
/* ===== Security / authentication UI (server re-checks every action; this only shapes the UI) ===== */
const PASS_RE=/^[A-Za-z0-9]{8,}$/,USER_RE=/^[A-Za-z0-9_.-]{3,12}$/,EMAIL_RE=/^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PW_MSG='Password must be letters and numbers only, at least 8 characters.';
function msg(id,text,bad){const e=$(id);e.textContent=text||'';e.style.color=bad?'var(--bad)':'var(--ok)'}
function run(btn,p,onErr){btn.disabled=true;return p.catch(onErr).finally(()=>{btn.disabled=false})}
function openModal(){showView('login');$('modal').classList.remove('hide');$('l_user').focus()}
function closeModal(){$('modal').classList.add('hide');['l_pass','r_code','r_new'].forEach(i=>$(i).value='');['m_login','m_reset'].forEach(i=>msg(i,''))}
function showView(v){$('v_login').classList.toggle('hide',v!=='login');$('v_forgot').classList.toggle('hide',v!=='forgot')}

function applyAuth(){
  const a=!!AUTH.me.admin;
  document.body.classList.toggle('is-admin',a);
  $('roleBadge').textContent=a?'Admin: '+AUTH.me.name:'View only';
  $('roleBadge').style.background=a?'var(--ok)':'var(--mut)';
  $('btnLogout').classList.toggle('hide',AUTH.me.via==='google');
  if(!a&&!$('admin').classList.contains('hide'))document.querySelector('#tabs [data-t=dash]').click();
  if(a){
    $('acctInfo').textContent=AUTH.me.via==='google'?`Signed in with Google account ${AUTH.me.name}. Password settings apply to username/password admins only.`:`Signed in as ${AUTH.me.name}.`;
    $('acctPw').classList.toggle('hide',AUTH.me.via!=='password');
    $('a_email').value=AUTH.me.email||'';$('a_reset').checked=!!AUTH.me.resetEnabled;
    $('pwWarn').classList.toggle('hide',!AUTH.me.mustChange);
  }
}
function refreshAdminLists(){
  if(!AUTH.me.admin)return;
  api('listAdmins').then(r=>{
    $('adminList').innerHTML='<tr><th>Username</th><th>Email</th><th>Email reset</th><th>Created by</th><th></th></tr>'+
      r.admins.map(u=>`<tr><td>${esc(u.username)}</td><td>${esc(u.email)||'<span class="sub">none</span>'}</td><td>${u.resetEnabled?'On':'Off'}</td><td>${esc(u.createdBy)}</td><td><button class="lnk" data-ra="${esc(u.username)}">Remove</button></td></tr>`).join('');
    $('emailList').innerHTML='<tr><th>Email</th><th>Added by</th><th></th></tr>'+
      (r.emails.map(e=>`<tr><td>${esc(e.email)}</td><td>${esc(e.addedBy)}</td><td><button class="lnk" data-re="${esc(e.email)}">Remove</button></td></tr>`).join('')||'<tr><td colspan="3" class="sub">No Google emails added.</td></tr>');
  }).catch(e=>showError(e.message));
}

$('btnLogin').onclick=openModal;
$('l_cancel').onclick=closeModal;
$('l_forgot').onclick=()=>{showView('forgot');$('r_id').value=$('l_user').value;$('r_id').focus()};
$('r_back').onclick=()=>showView('login');
$('modal').onclick=e=>{if(e.target===$('modal'))closeModal()};
$('l_pass').onkeydown=e=>{if(e.key==='Enter')$('l_go').click()};
$('l_go').onclick=()=>{
  msg('m_login','');
  run($('l_go'),api('login',$('l_user').value.trim(),$('l_pass').value).then(r=>{
    AUTH.me=r.me;closeModal();applyAuth();showError('');
  }),e=>msg('m_login',e.message,true));
};
$('btnLogout').onclick=()=>{
  api('logout').catch(()=>{}).finally(()=>{AUTH.me={admin:false};applyAuth();load(true)});
};
$('r_send').onclick=()=>{
  if(!$('r_id').value.trim())return msg('m_reset','Enter your username or email.',true);
  run($('r_send'),api('requestReset',$('r_id').value.trim()).then(r=>msg('m_reset',r.message)),e=>msg('m_reset',e.message,true));
};
$('r_go').onclick=()=>{
  if(!PASS_RE.test($('r_new').value))return msg('m_reset',PW_MSG,true);
  run($('r_go'),api('confirmReset',$('r_id').value.trim(),$('r_code').value.trim(),$('r_new').value).then(()=>{
    showView('login');$('l_user').value=$('r_id').value;msg('m_login','Password updated. Please log in.');
  }),e=>msg('m_reset',e.message,true));
};

$('a_pw').onclick=()=>{
  if(!PASS_RE.test($('a_new').value))return msg('m_pw',PW_MSG,true);
  if($('a_new').value!==$('a_new2').value)return msg('m_pw','New passwords do not match.',true);
  run($('a_pw'),api('changePassword',$('a_cur').value,$('a_new').value).then(r=>{
    AUTH.me=r.me;applyAuth();['a_cur','a_new','a_new2'].forEach(i=>$(i).value='');msg('m_pw','Password updated.');
  }),e=>msg('m_pw',e.message,true));
};
$('a_save').onclick=()=>{
  const email=$('a_email').value.trim();
  if(email&&!EMAIL_RE.test(email))return msg('m_acct','Enter a valid email address.',true);
  if($('a_reset').checked&&!email)return msg('m_acct','An email is required to enable password reset.',true);
  run($('a_save'),api('updateAccount',{email,resetEnabled:$('a_reset').checked}).then(me=>{AUTH.me=me;applyAuth();msg('m_acct','Saved.')}),e=>msg('m_acct',e.message,true));
};
$('g_go').onclick=()=>{
  const f={username:$('g_user').value.trim(),password:$('g_pass').value,email:$('g_email').value.trim(),resetEnabled:$('g_reset').checked};
  if(!USER_RE.test(f.username))return msg('m_reg','Username must be 3–12 characters (letters, numbers, . _ -).',true);
  if(!PASS_RE.test(f.password))return msg('m_reg',PW_MSG,true);
  if(!EMAIL_RE.test(f.email))return msg('m_reg','Enter a valid email address.',true);
  run($('g_go'),api('registerAdmin',f).then(()=>{['g_user','g_pass','g_email'].forEach(i=>$(i).value='');msg('m_reg','Admin registered.');refreshAdminLists()}),e=>msg('m_reg',e.message,true));
};
$('e_add').onclick=()=>{
  const em=$('e_email').value.trim();
  if(!EMAIL_RE.test(em))return msg('m_email','Enter a valid email address.',true);
  run($('e_add'),api('addAdminEmail',em).then(()=>{$('e_email').value='';msg('m_email','Added.');refreshAdminLists()}),e=>msg('m_email',e.message,true));
};
$('admin').onclick=e=>{
  const ra=e.target.dataset.ra,re=e.target.dataset.re;
  if(ra&&confirm('Remove admin "'+ra+'"?'))api('removeAdmin',ra).then(refreshAdminLists).catch(x=>showError(x.message));
  if(re&&confirm('Remove admin access for '+re+'?'))api('removeAdminEmail',re).then(refreshAdminLists).catch(x=>showError(x.message));
};

/* ===== Mobile collapse toggles ===== */
$('menuBtn').onclick=()=>{const o=$('tabs').classList.toggle('open');$('menuBtn').setAttribute('aria-expanded',String(o))};
$('filtBtn').onclick=()=>$('filtBody').classList.toggle('open');
load();
// refresh when the tab regains focus so teammates' changes appear (served from server cache, so cheap)
document.addEventListener('visibilitychange',()=>{if(!document.hidden&&!pending)load(true)});

/* ===== Optional "Sign in with Google" (shown only when GOOGLE_CLIENT_ID is configured) ===== */
fetch('/api/config').then(r=>r.json()).then(c=>{
  if(!c.googleClientId)return;
  const s=document.createElement('script');s.src='https://accounts.google.com/gsi/client';s.async=true;
  s.onload=()=>{
    google.accounts.id.initialize({client_id:c.googleClientId,callback:resp=>{
      api('googleLogin',resp.credential).then(x=>{AUTH.me=x.me;closeModal();applyAuth();showError('')}).catch(e=>msg('m_login',e.message,true));
    }});
    google.accounts.id.renderButton($('gsi'),{theme:'outline',size:'large',text:'signin_with'});
  };
  document.head.appendChild(s);
}).catch(()=>{});
