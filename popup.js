const $ = (s) => document.querySelector(s);
const API = "https://api.mail.tm";
const state = {tab:null, credentials:null, busy:false, mailbox:null};

function rand(n=10) {
  const chars = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(n); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join("");
}
function password(n=20) {
  const groups = ["ABCDEFGHJKLMNPQRSTUVWXYZ","abcdefghijkmnopqrstuvwxyz","23456789","!@#$%*-_+"];
  const all = groups.join("");
  const values = groups.map(g => g[crypto.getRandomValues(new Uint32Array(1))[0] % g.length]);
  const extra = new Uint32Array(n - values.length); crypto.getRandomValues(extra);
  for (const b of extra) values.push(all[b % all.length]);
  for (let i=values.length-1;i>0;i--) { const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1); [values[i],values[j]]=[values[j],values[i]]; }
  return values.join("");
}
function makeCredentials() { return {username:"forge-"+rand(9),password:password()}; }
function status(title,message) { $("#status").hidden=false; $("#statusTitle").textContent=title; $("#statusMessage").textContent=message; }
function preview() {
  const c=state.credentials;
  $("#userPreview").textContent=c?.username||"forge-••••••";
  $("#passPreview").textContent=c?.password||"••••••••••••••••";
  $("#copyUser").disabled=!c; $("#copyPass").disabled=!c;
}
async function copy(value) {
  if (!value) return;
  try { await navigator.clipboard.writeText(value); status("Copied","Copied to clipboard."); }
  catch { status("Copy blocked","Clipboard access was blocked by Chrome."); }
}
async function api(path, options={}) {
  let response;
  try { response=await fetch(API+path,{...options,headers:{...(options.headers||{}),...(options.body?{"Content-Type":"application/json"}:{})}}); }
  catch { throw new Error("Could not reach Mail.tm. Check your internet connection."); }
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error("Mail.tm: "+(data.detail||data.message||data["hydra:description"]||("HTTP "+response.status)));
  return data;
}
async function saveMailbox(box) {
  await chrome.storage.local.set({temporaryMailbox:box});
  state.mailbox=box;
}
async function authApi(box,path,options={}) {
  const call=(token)=>fetch(API+path,{...options,headers:{...(options.headers||{}),Authorization:"Bearer "+token,...(options.body?{"Content-Type":"application/json"}:{})}});
  let response;
  try { response=await call(box.token); } catch { throw new Error("Could not reach Mail.tm. Check your internet connection."); }
  if(response.status===401) {
    const auth=await api("/token",{method:"POST",body:JSON.stringify({address:box.address,password:box.password})});
    box.token=auth.token; await saveMailbox(box); response=await call(box.token);
  }
  const data=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error("Mail.tm: "+(data.detail||data.message||data["hydra:description"]||("HTTP "+response.status)));
  return data;
}
async function createMailbox() {
  const button=$("#createMailbox");
  if(button.disabled) return;
  if(state.mailbox&&!confirm("Create a new temporary inbox? This replaces the currently saved inbox in this extension.")) return;
  button.disabled=true; button.textContent="Creating inbox…";
  try {
    const info=await api("/domains?page=1");
    const domains=(info["hydra:member"]||[]).filter(d=>d.isActive&&!d.isPrivate&&d.domain);
    if(!domains.length) throw new Error("Mail.tm did not provide an available email domain.");
    const domain=domains[crypto.getRandomValues(new Uint32Array(1))[0]%domains.length].domain;
    const address="af"+rand(14)+"@"+domain, secret=password(28);
    const account=await api("/accounts",{method:"POST",body:JSON.stringify({address,password:secret})});
    const auth=await api("/token",{method:"POST",body:JSON.stringify({address,password:secret})});
    const box={id:account.id||auth.id||"",address,password:secret,token:auth.token,domain,createdAt:new Date().toISOString()};
    await saveMailbox(box);
    $("#email").value=address; $("#mailboxAddress").textContent=address; $("#mailboxCurrent").hidden=false;
    status("Temporary inbox ready","The new address has been inserted into the email field. Use Refresh inbox to check messages.");
    await refreshInbox(false);
  } catch(error) { status("Could not create inbox",String(error?.message||error)); }
  finally { button.disabled=false; button.textContent="＋ Create another temporary inbox"; }
}
function renderMessageBody(card, message, text, links=[]) {
  let body=card.querySelector(".mailBody");
  if(!body){body=document.createElement("p");body.className="mailBody";card.append(body);}
  body.textContent=String(text||message.intro||"No readable text in this email.").slice(0,7000);
  const match=body.textContent.match(/\b\d{4,8}\b/);
  if(match&&!card.querySelector(".codeButton")) {
    const codeBtn=document.createElement("button"); codeBtn.className="codeButton";codeBtn.textContent="Copy possible code: "+match[0];
    codeBtn.addEventListener("click",()=>copy(match[0]));card.append(codeBtn);
  }
  for (const href of [...new Set(links)].slice(0,5)) { try { const u=new URL(href); if(!["http:","https:"].includes(u.protocol))continue; const b=document.createElement("button");b.className="mailLinkButton";b.textContent="Open email link: "+u.hostname;b.addEventListener("click",()=>chrome.tabs.create({url:u.href}));card.append(b); } catch {} }
}
async function openMessage(message,card,button) {
  button.disabled=true;button.textContent="Loading…";
  try {
    const full=await authApi(state.mailbox,"/messages/"+encodeURIComponent(message.id));
    let body=full.text||"";const links=[];
    if(Array.isArray(full.html)){const parser=new DOMParser();const docs=full.html.map(part=>parser.parseFromString(String(part),"text/html"));if(!body)body=docs.map(doc=>doc.body.textContent||"").join("\n");for(const doc of docs)for(const a of doc.querySelectorAll("a[href]"))links.push(a.href);}
    renderMessageBody(card,message,body||full.intro||"No readable text in this email.",links);
    button.textContent="Reload email";
    if(!full.seen) authApi(state.mailbox,"/messages/"+encodeURIComponent(message.id),{method:"PATCH"}).catch(()=>{});
  } catch(error) { button.textContent="Read email"; status("Could not load email",String(error?.message||error)); }
  finally { button.disabled=false; }
}
async function refreshInbox(showStatus=true) {
  if(!state.mailbox) return;
  const list=$("#inboxMessages");list.replaceChildren();
  const wait=document.createElement("div");wait.className="emptyInbox";wait.textContent="Checking inbox…";list.append(wait);
  $("#refreshInbox").disabled=true;
  try {
    const data=await authApi(state.mailbox,"/messages?page=1");
    const messages=data["hydra:member"]||[];list.replaceChildren();
    if(!messages.length){const empty=document.createElement("div");empty.className="emptyInbox";empty.textContent="No messages yet. Refresh again after using this email address.";list.append(empty);}
    for(const message of messages.slice(0,10)){
      const card=document.createElement("article");card.className="msg";card.dataset.messageId=message.id;
      const title=document.createElement("b");title.textContent=message.subject||"(No subject)";
      const date=document.createElement("small");date.textContent=message.createdAt?new Date(message.createdAt).toLocaleString():"";
      const from=document.createElement("p");from.textContent="From: "+(message.from?.address||message.from?.name||"unknown");
      const intro=document.createElement("p");intro.textContent=message.intro||"";
      const button=document.createElement("button");button.textContent="Read email";button.addEventListener("click",()=>openMessage(message,card,button));
      card.append(title,document.createElement("br"),date,from,intro,button);list.append(card);
    }
    if(showStatus) status("Inbox refreshed",messages.length+" message(s) found for "+state.mailbox.address+".");
  } catch(error) {
    list.replaceChildren();const fail=document.createElement("div");fail.className="emptyInbox";fail.textContent=String(error?.message||error);list.append(fail);
    if(showStatus) status("Inbox unavailable",String(error?.message||error));
  } finally { $("#refreshInbox").disabled=false; }
}
async function currentTab() {
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true});state.tab=tab||null;
  try {
    const url=new URL(tab?.url||"");if(!["http:","https:"].includes(url.protocol))throw new Error();
    $("#siteName").textContent=url.hostname;$("#siteUrl").textContent=url.origin+url.pathname;$("#create").disabled=false;
  } catch { $("#siteName").textContent="No supported website";$("#siteUrl").textContent="Open a normal http(s) sign-up page";$("#create").disabled=true; }
}
async function accounts() { const r=await chrome.storage.local.get({accounts:[]});return Array.isArray(r.accounts)?r.accounts:[]; }
async function renderAccounts() {
  const items=await accounts();$("#accounts").replaceChildren();$("#accountCount").textContent=items.length+" saved account(s) · local to this device";$("#empty").hidden=items.length>0;
  for(const item of items.slice(0,10)){
    const card=document.createElement("article");card.className="account";
    const host=document.createElement("div");host.className="host";host.textContent=item.host||"Website";
    const detail=document.createElement("div");detail.className="detail";detail.textContent=[item.username,item.email].filter(Boolean).join(" · ");
    const stateText=document.createElement("div");stateText.className="detail";stateText.textContent=item.status;
    const userBtn=document.createElement("button");userBtn.className="small";userBtn.textContent="Copy user";userBtn.addEventListener("click",()=>copy(item.username));
    const passBtn=document.createElement("button");passBtn.className="small";passBtn.textContent="Copy password";passBtn.addEventListener("click",()=>copy(item.password));
    const complete=document.createElement("button");complete.className="small";complete.textContent=item.status==="marked complete"?"Mark pending":"Mark complete";complete.addEventListener("click",async()=>{const all=await accounts();const target=all.find(a=>a.id===item.id);if(target)target.status=target.status==="marked complete"?"pending verification":"marked complete";await chrome.storage.local.set({accounts:all});await renderAccounts();});
    card.append(host,detail,stateText,userBtn,passBtn,complete);$("#accounts").append(card);
  }
}
async function create() {
  if(state.busy||!state.tab?.id||!state.credentials)return;
  state.busy=true;$("#create").disabled=true;
  const existing=await chrome.storage.local.get({draftAccount:null});
  const record={id:existing.draftAccount?.id||crypto.randomUUID(),url:state.tab.url,host:new URL(state.tab.url).hostname,email:$("#email").value.trim()||state.mailbox?.address||existing.draftAccount?.email||"",displayName:$("#name").value.trim()||existing.draftAccount?.displayName||"",username:state.credentials.username,password:state.credentials.password,createdAt:existing.draftAccount?.createdAt||new Date().toISOString(),status:"signup in progress"};
  try {
    await chrome.storage.local.set({draftCredentials:state.credentials});
    await chrome.scripting.executeScript({target:{tabId:state.tab.id},files:["content.js"]});
    const result=await chrome.tabs.sendMessage(state.tab.id,{type:"ACCOUNT_FORGE_FILL",credentials:{...state.credentials,email:record.email,displayName:record.displayName},autoSubmit:$("#autoSubmit").checked});
    if(!result?.ok)throw new Error(result?.error||"Could not detect an editable form.");
    const filledMatch=(result.message||"").match(/^Filled (.*?)\./);const filled=filledMatch?filledMatch[1].split(", "):[];
    if(filled.includes("password")) {
      record.status=result.submitted?"submitted; verify on site":"filled; review and submit";
      const all=await accounts();all.unshift(record);await chrome.storage.local.set({accounts:all.slice(0,100),draftCredentials:null,draftAccount:null});state.credentials=null;preview();await renderAccounts();
      status("Form filled",result.message+" Credentials saved. Confirm registration and verification on the website.");
    } else if(filled.length) {
      await chrome.storage.local.set({draftAccount:record,draftCredentials:state.credentials});
      status("Sign-up step filled",result.message+" The same credentials are saved as a draft. Continue on the website and reopen Account Forge on the next step.");
    } else status("No matching fields",result.message+" Your generated credentials are kept as a draft.");
  } catch(error) { status("Could not fill this page",String(error?.message||error)+". You can enter the values manually."); }
  finally {state.busy=false;$("#create").disabled=!/^https?:/i.test(state.tab?.url||"");}
}
$("#refresh").addEventListener("click",currentTab);
$("#create").addEventListener("click",create);
$("#createMailbox").addEventListener("click",createMailbox);
$("#copyMailbox").addEventListener("click",()=>copy(state.mailbox?.address||""));
$("#refreshInbox").addEventListener("click",()=>refreshInbox(true));
$("#copyUser").addEventListener("click",()=>copy(state.credentials?.username||""));
$("#copyPass").addEventListener("click",()=>copy(state.credentials?.password||""));
$("#export").addEventListener("click",async()=>{const blob=new Blob([JSON.stringify(await accounts(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="account-forge-export-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(url);});
$("#clear").addEventListener("click",async()=>{if(confirm("Delete all saved account records? This cannot be undone.")){await chrome.storage.local.set({accounts:[]});await renderAccounts();status("Account list cleared","Saved account records were removed.");}});
async function initialize() {
  const saved=await chrome.storage.local.get({draftCredentials:null,temporaryMailbox:null});
  state.credentials=saved.draftCredentials?.username&&saved.draftCredentials?.password?saved.draftCredentials:makeCredentials();
  await chrome.storage.local.set({draftCredentials:state.credentials});
  preview();
  await Promise.all([currentTab(),renderAccounts()]);
  if(saved.temporaryMailbox){state.mailbox=saved.temporaryMailbox;$("#mailboxAddress").textContent=state.mailbox.address;$("#mailboxCurrent").hidden=false;if(!$("#email").value)$("#email").value=state.mailbox.address;await refreshInbox(false);}
}
initialize();