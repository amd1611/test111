const $ = (s) => document.querySelector(s);
const API = "https://api.mail.tm";
const state = {tab:null, credentials:null, busy:false, fillBusy:false, smsBusy:false, mailbox:null, smsMessages:[]};
const SMS_WINDOW_MS = 5 * 60 * 1000;

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

const PROFILE_FIELDS = ["name","age","firstName","lastName","birthDate","phone","country"];
function readProfile() {
  return {
    displayName: $("#name").value.trim(),
    age: $("#age").value.trim(),
    firstName: $("#firstName").value.trim(),
    lastName: $("#lastName").value.trim(),
    birthDate: $("#birthDate").value.trim(),
    phone: $("#phone").value.trim(),
    country: $("#country").value.trim()
  };
}
function applyProfile(profile = {}) {
  $("#name").value = profile.displayName || "";
  for (const key of PROFILE_FIELDS.slice(1)) {
    const field = $("#"+key);
    if (field && typeof profile[key] === "string") field.value = profile[key];
  }
}
async function saveProfile() { await chrome.storage.local.set({signupProfile:readProfile()}); }
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
async function fillPageOnly() {
  if(state.fillBusy)return;
  await currentTab();
  if(!state.tab?.id||!/^https?:/i.test(state.tab.url||"")){status("No supported page","Open the website form first, then try Fill page only.");return;}
  state.fillBusy=true;
  const button=document.querySelector("#fillPageButton");button.disabled=true;button.textContent="Filling fields…";
  try{
    if(!state.credentials)state.credentials=makeCredentials();
    preview();
    const old=await chrome.storage.local.get({draftAccount:null});
    const profile={...readProfile(),email:$("#email").value.trim()||state.mailbox?.address||""};
    await chrome.storage.local.set({draftCredentials:state.credentials,signupProfile:readProfile()});
    await chrome.scripting.executeScript({target:{tabId:state.tab.id},files:["content.js"]});
    const result=await chrome.tabs.sendMessage(state.tab.id,{type:"ACCOUNT_FORGE_FILL",credentials:{...state.credentials,email:profile.email,displayName:profile.displayName,profile},autoSubmit:false});
    if(!result?.ok)throw new Error(result?.error||"The page did not respond.");
    const filled=Array.isArray(result.filledFields)?result.filledFields:[];
    if(!filled.length){status("No matching fields",result.message||"No recognizable fields were found.");return;}
    const draft={id:old.draftAccount?.id||crypto.randomUUID(),url:state.tab.url,host:new URL(state.tab.url).hostname,email:profile.email,displayName:profile.displayName,username:state.credentials.username,password:state.credentials.password,createdAt:old.draftAccount?.createdAt||new Date().toISOString(),status:"signup in progress"};
    await chrome.storage.local.set({draftAccount:draft,draftCredentials:state.credentials});
    status("Page filled — not submitted",result.message+" Nothing was submitted. Review the fields and continue manually.");
  }catch(error){status("Could not fill this page",String(error?.message||error)+". Copy the values and enter them manually if necessary.");}
  finally{state.fillBusy=false;button.disabled=false;button.textContent="▣  Fill page only — don’t submit";}
}

async function create() {
  if(state.busy||!state.tab?.id||!state.credentials)return;
  state.busy=true;$("#create").disabled=true;
  const existing=await chrome.storage.local.get({draftAccount:null});
  const record={id:existing.draftAccount?.id||crypto.randomUUID(),url:state.tab.url,host:new URL(state.tab.url).hostname,email:$("#email").value.trim()||state.mailbox?.address||existing.draftAccount?.email||"",displayName:$("#name").value.trim()||existing.draftAccount?.displayName||"",username:state.credentials.username,password:state.credentials.password,createdAt:existing.draftAccount?.createdAt||new Date().toISOString(),status:"signup in progress"};
  try {
    await chrome.storage.local.set({draftCredentials:state.credentials});
    await chrome.scripting.executeScript({target:{tabId:state.tab.id},files:["content.js"]});
    const profile={...readProfile(),displayName:record.displayName,email:record.email};await chrome.storage.local.set({signupProfile:readProfile()});const result=await chrome.tabs.sendMessage(state.tab.id,{type:"ACCOUNT_FORGE_FILL",credentials:{...state.credentials,email:record.email,displayName:record.displayName,profile},autoSubmit:$("#autoSubmit").checked});
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
$("#fillPageButton").addEventListener("click",fillPageOnly);
$("#saveSmsBridge").addEventListener("click",saveSmsBridge);
$("#refreshSmsInbox").addEventListener("click",refreshSmsInbox);
$("#createMailbox").addEventListener("click",createMailbox);
$("#copyMailbox").addEventListener("click",()=>copy(state.mailbox?.address||""));
$("#refreshInbox").addEventListener("click",()=>refreshInbox(true));
$("#copyUser").addEventListener("click",()=>copy(state.credentials?.username||""));
$("#copyPass").addEventListener("click",()=>copy(state.credentials?.password||""));
$("#export").addEventListener("click",async()=>{const blob=new Blob([JSON.stringify(await accounts(),null,2)],{type:"application/json"});const url=URL.createObjectURL(blob);const a=document.createElement("a");a.href=url;a.download="account-forge-export-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(url);});
$("#clear").addEventListener("click",async()=>{if(confirm("Delete all saved account records? This cannot be undone.")){await chrome.storage.local.set({accounts:[]});await renderAccounts();status("Account list cleared","Saved account records were removed.");}});

function normalizedText(value){
  return String(value||"").normalize("NFKD").replace(/[\u0300-\u036f]/g,"").toLowerCase().replace(/[^a-z0-9]+/g," ").trim();
}
const SMS_STOP_WORDS=new Set(["www","com","net","org","co","uk","io","ai","app","accounts","account","auth","login","signin","signup","register","registration","secure","identity","home","welcome","official","the","and","for","your","are","how","old"]);
const SMS_ALIASES={chatgpt:["openai"],openai:["chatgpt"],gmail:["google"],google:["gmail"],outlook:["microsoft"],microsoft:["outlook","live"],instagram:["meta"],facebook:["meta"],meta:["instagram","facebook"],twitter:["x"],amazon:["aws"],aws:["amazon"]};
function siteKeywords(){
  const url=state.tab?.url||"",title=state.tab?.title||"";
  let host="";try{host=new URL(url).hostname;}catch{}
  const tokens=host.split(".").flatMap((part)=>part.split(/[-_]/)).concat(normalizedText(title).split(/\s+/))
    .map(normalizedText).filter((word)=>word.length>=3&&!SMS_STOP_WORDS.has(word));
  const words=new Set(tokens);for(const word of [...words])for(const alias of (SMS_ALIASES[word]||[]))words.add(alias);
  return {host,words:[...words]};
}
function smsTimestamp(message){
  const raw=message.receivedAt||message.timestamp||message.createdAt||message.date||message.received_at;
  const stamp=typeof raw==="number"?(raw<1e12?raw*1000:raw):Date.parse(raw||"");
  return Number.isFinite(stamp)?stamp:0;
}
function smsCode(message){
  const body=String(message.body||message.message||message.text||"");
  const codes=body.match(/(?<!\d)\d{4,8}(?!\d)/g)||[];
  if(!codes.length)return "";
  const hasSignal=/verification|verify|security|sign.?in|login|one.?time|\botp\b|passcode|authentication|auth code|confirmation|confirm your|use this code|your code/i.test(body);
  return hasSignal?codes[0]:(codes.find((code)=>code.length>=5)||codes[0]);
}
function filterRelevantSms(messages){
  const site=siteKeywords(),now=Date.now();
  return messages.map((message)=>{
    const receivedAt=smsTimestamp(message),body=String(message.body||message.message||message.text||"");
    const sender=String(message.senderName||message.fromName||message.from||message.sender||message.source||"Unknown sender");
    const searchable=" "+normalizedText(sender+" "+body)+" ";
    const matchedKeyword=site.words.find((word)=>searchable.includes(" "+word+" "));
    return {...message,receivedAt,body,sender,code:smsCode(message),matchedKeyword};
  }).filter((message)=>{
    const age=now-message.receivedAt;
    return message.code&&message.receivedAt>0&&age>=-60000&&age<=SMS_WINDOW_MS&&message.matchedKeyword;
  }).sort((a,b)=>b.receivedAt-a.receivedAt).slice(0,8);
}
function smsStatus(message,isError=false){
  const node=$("#smsConnectionStatus");node.textContent=message;node.style.color=isError?"#ff8b91":"#a4b2c9";
}
function renderSmsMessages(messages){
  const list=$("#smsMessages");list.replaceChildren();
  if(!messages.length){const empty=document.createElement("div");empty.className="emptyInbox";empty.textContent="No matching code SMS from this site in the last 5 minutes.";list.append(empty);return;}
  for(const message of messages){
    const card=document.createElement("article");card.className="sms-message";
    const top=document.createElement("div");top.className="sms-message-top";
    const sender=document.createElement("div");sender.className="sms-sender";sender.textContent=message.sender;
    const date=document.createElement("div");date.className="sms-time";date.textContent=new Date(message.receivedAt).toLocaleTimeString([], {hour:"2-digit",minute:"2-digit",second:"2-digit"});
    top.append(sender,date);
    const matched=document.createElement("div");matched.className="sms-site-match";matched.textContent="Matched current site: "+message.matchedKeyword;
    const body=document.createElement("div");body.className="sms-body";body.textContent=message.body.slice(0,360);
    const code=document.createElement("div");code.className="sms-code";code.textContent=message.code;
    const actions=document.createElement("div");actions.className="sms-actions";
    const copyButton=document.createElement("button");copyButton.textContent="Copy code";copyButton.addEventListener("click",()=>copy(message.code));
    actions.append(copyButton);card.append(top,matched,body,code,actions);list.append(card);
  }
}
async function saveSmsBridge(){
  const raw=$("#smsBridgeUrl").value.trim(),token=$("#smsReadToken").value.trim();let url;
  try{url=new URL(raw);}catch{smsStatus("Enter a valid bridge URL.",true);return;}
  const localHttp=url.protocol==="http:"&&["localhost","127.0.0.1"].includes(url.hostname);
  if(url.protocol!=="https:"&&!localHttp){smsStatus("Use HTTPS except for localhost testing.",true);return;}
  if(!token){smsStatus("Enter the private SMS_READ_TOKEN from your bridge.",true);return;}
  const granted=await chrome.permissions.request({origins:[url.origin+"/*"]});
  if(!granted){smsStatus("Chrome did not grant permission to this bridge origin.",true);return;}
  const config={url:url.origin,token};await chrome.storage.local.set({smsBridgeConfig:config});
  smsStatus("Bridge saved. Checking recent messages…");await refreshSmsInbox();
}
async function refreshSmsInbox(){
  if(state.smsBusy)return;
  state.smsBusy=true;const button=$("#refreshSmsInbox");button.disabled=true;button.textContent="Checking SMS…";
  try{
    await currentTab();
    const saved=await chrome.storage.local.get({smsBridgeConfig:null}),config=saved.smsBridgeConfig;
    if(!config?.url||!config?.token){smsStatus("Not connected — configure your private bridge below.",true);renderSmsMessages([]);return;}
    const url=new URL("/api/messages",config.url);url.searchParams.set("since",new Date(Date.now()-SMS_WINDOW_MS).toISOString());
    const response=await fetch(url.href,{headers:{Authorization:"Bearer "+config.token,Accept:"application/json"}});
    const data=await response.json().catch(()=>({}));
    if(!response.ok)throw new Error(data.error||data.message||("SMS bridge returned HTTP "+response.status));
    const messages=Array.isArray(data)?data:(Array.isArray(data.messages)?data.messages:[]);
    const matched=filterRelevantSms(messages);state.smsMessages=matched;renderSmsMessages(matched);
    smsStatus("Connected · "+matched.length+" matching code message(s) for "+(siteKeywords().host||"this page")+" in the last 5 minutes.");
  }catch(error){renderSmsMessages([]);smsStatus(String(error?.message||error),true);}
  finally{state.smsBusy=false;button.disabled=false;button.textContent="↻ Refresh SMS";}
}

async function initialize() {
  const saved=await chrome.storage.local.get({draftCredentials:null,temporaryMailbox:null,signupProfile:{}});
  applyProfile(saved.signupProfile||{});
  state.credentials=saved.draftCredentials?.username&&saved.draftCredentials?.password?saved.draftCredentials:makeCredentials();
  await chrome.storage.local.set({draftCredentials:state.credentials});
  preview();
  await Promise.all([currentTab(),renderAccounts()]);
  if(saved.temporaryMailbox){state.mailbox=saved.temporaryMailbox;$("#mailboxAddress").textContent=state.mailbox.address;$("#mailboxCurrent").hidden=false;if(!$("#email").value)$("#email").value=state.mailbox.address;await refreshInbox(false);}
  const smsSaved=await chrome.storage.local.get({smsBridgeConfig:null});
  if(smsSaved.smsBridgeConfig){$("#smsBridgeUrl").value=smsSaved.smsBridgeConfig.url||"";$("#smsReadToken").value=smsSaved.smsBridgeConfig.token||"";await refreshSmsInbox();setInterval(()=>{if(!state.smsBusy)refreshSmsInbox();},15000);}
  else renderSmsMessages([]);
}
for (const id of PROFILE_FIELDS) {
  const field = $("#"+id);
  field.addEventListener("input", () => { saveProfile().catch(() => {}); });
  field.addEventListener("change", () => { saveProfile().catch(() => {}); });
}
initialize();