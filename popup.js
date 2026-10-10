const $ = (s) => document.querySelector(s);
const state = { tab: null, credentials: null, busy: false };
function randomString(length=9) {
  const alphabet = "abcdefghjkmnpqrstuvwxyz23456789";
  const bytes = new Uint8Array(length); crypto.getRandomValues(bytes);
  return Array.from(bytes, b => alphabet[b % alphabet.length]).join("");
}
function password(length=20) {
  const sets = ["ABCDEFGHJKLMNPQRSTUVWXYZ","abcdefghijkmnopqrstuvwxyz","23456789","!@#$%*-_+"];
  const all = sets.join(""), chars = sets.map(s => s[crypto.getRandomValues(new Uint32Array(1))[0] % s.length]);
  const more = new Uint32Array(length-chars.length); crypto.getRandomValues(more);
  for (const n of more) chars.push(all[n % all.length]);
  for (let i=chars.length-1;i>0;i--) { const j=crypto.getRandomValues(new Uint32Array(1))[0]%(i+1); [chars[i],chars[j]]=[chars[j],chars[i]]; }
  return chars.join("");
}
function newCredentials(){ return {username:"forge-"+randomString(), password:password()}; }
function status(title,message){ $("#status").hidden=false; $("#statusTitle").textContent=title; $("#statusMessage").textContent=message; }
function preview(){
  const c=state.credentials; $("#userPreview").textContent=c?.username||"forge-••••••"; $("#passPreview").textContent=c?.password||"••••••••••••••••";
  $("#copyUser").disabled=!c; $("#copyPass").disabled=!c;
}
async function currentTab(){
  const [tab]=await chrome.tabs.query({active:true,currentWindow:true}); state.tab=tab||null;
  try {
    const url=new URL(tab?.url||""); if (!["http:","https:"].includes(url.protocol)) throw new Error();
    $("#siteName").textContent=url.hostname; $("#siteUrl").textContent=url.origin+url.pathname; $("#create").disabled=false;
  } catch { $("#siteName").textContent="No supported website"; $("#siteUrl").textContent="Open a normal http(s) sign-up page"; $("#create").disabled=true; }
}
async function accounts(){ const r=await chrome.storage.local.get({accounts:[]}); return Array.isArray(r.accounts)?r.accounts:[]; }
async function render(){
  const items=await accounts(); $("#accounts").replaceChildren(); $("#accountCount").textContent=items.length+" saved "+(items.length===1?"account":"accounts")+" · local to this device"; $("#empty").hidden=items.length>0;
  for(const item of items.slice(0,10)){
    const card=document.createElement("article"); card.className="account";
    const host=document.createElement("div"); host.className="host"; host.textContent=item.host||"Website";
    const detail=document.createElement("div"); detail.className="detail"; detail.textContent=[item.username,item.email].filter(Boolean).join(" · ")||"No email provided";
    const stateLabel=document.createElement("div"); stateLabel.className="detail"; stateLabel.textContent=item.status;
    const actions=document.createElement("div");
    const makeButton=(label,fn)=>{const b=document.createElement("button");b.className="small";b.textContent=label;b.addEventListener("click",fn);return b;};
    actions.append(makeButton("Copy user",()=>copy(item.username)),makeButton("Copy password",()=>copy(item.password)),makeButton(item.status==="marked complete"?"Mark pending":"Mark complete",async()=>{
      const all=await accounts(), target=all.find(a=>a.id===item.id);
      if(target)target.status=target.status==="marked complete"?"pending verification":"marked complete";
      await chrome.storage.local.set({accounts:all}); await render();
    }));
    card.append(host,detail,stateLabel,actions); $("#accounts").append(card);
  }
  if(items.length>10){const note=document.createElement("p");note.className="fine";note.textContent="Showing 10 of "+items.length+" entries. Export to view all.";$("#accounts").append(note);}
}
async function copy(value){
  if(!value)return;
  try{await navigator.clipboard.writeText(value);status("Copied","Credential copied to clipboard.");}
  catch{status("Copy blocked","Clipboard access was blocked by the browser.");}
}
async function create(){
  if(state.busy||!state.tab?.id||!state.credentials)return;
  state.busy=true;$("#create").disabled=true;
  const buttonText=$("#create").textContent;$("#create").textContent="Checking sign-up form…";
  const record={id:crypto.randomUUID(),url:state.tab.url,host:(()=>{try{return new URL(state.tab.url).hostname}catch{return "unknown"}})(),email:$("#email").value.trim(),displayName:$("#name").value.trim(),username:state.credentials.username,password:state.credentials.password,createdAt:new Date().toISOString(),status:"pending verification"};
  try{
    await chrome.scripting.executeScript({target:{tabId:state.tab.id},files:["content.js"]});
    const result=await chrome.tabs.sendMessage(state.tab.id,{type:"ACCOUNT_FORGE_FILL",credentials:{...state.credentials,email:record.email,displayName:record.displayName},autoSubmit:$("#autoSubmit").checked});
    if(!result?.ok)throw new Error(result?.error||"Could not detect an editable form.");
    record.status=result.submitted?"submitted; verify on site":"filled; review and submit";
    const all=await accounts();all.unshift(record);await chrome.storage.local.set({accounts:all.slice(0,100)});await render();
    state.credentials=null;preview();status(result.submitted?"Form submitted":"Form filled",result.message+" Credentials were saved locally. Confirm the outcome on the website.");
  }catch(e){status("Could not fill this page",String(e?.message||e)+". You can copy the generated credentials and enter them manually.");}
  finally{state.busy=false;$("#create").disabled=!state.tab?.url?.match(/^https?:/i);$("#create").textContent="✦  Create account on this site  →";}
}
$("#create").addEventListener("click",create);$("#refresh").addEventListener("click",currentTab);
$("#copyUser").addEventListener("click",()=>copy(state.credentials?.username));$("#copyPass").addEventListener("click",()=>copy(state.credentials?.password));
$("#export").addEventListener("click",async()=>{
  const blob=new Blob([JSON.stringify(await accounts(),null,2)],{type:"application/json"}),url=URL.createObjectURL(blob),a=document.createElement("a");
  a.href=url;a.download="account-forge-export-"+new Date().toISOString().slice(0,10)+".json";a.click();URL.revokeObjectURL(url);
});
$("#clear").addEventListener("click",async()=>{if(confirm("Delete all saved account records from this browser? This cannot be undone.")){await chrome.storage.local.set({accounts:[]});await render();status("Account list cleared","All saved records were removed.");}});
state.credentials=newCredentials();preview();currentTab();render();