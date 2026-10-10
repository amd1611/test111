(() => {
  if (window.__accountForgeListenerInstalled) return;
  window.__accountForgeListenerInstalled = true;

  const visible = (el) => {
    if (!el || !el.isConnected) return false;
    const style=getComputedStyle(el), rect=el.getBoundingClientRect();
    return style.display!=="none" && style.visibility!=="hidden" && Number(style.opacity)!==0 && rect.width>0 && rect.height>0 && !el.disabled && !el.readOnly;
  };
  const descriptors=(el) => [
    el.name,el.id,el.type,el.autocomplete,el.placeholder,el.getAttribute("aria-label"),
    el.getAttribute("data-testid")
  ].filter(Boolean).join(" ").toLowerCase();
  const labels=(el) => {
    let s="";
    try { if(el.labels)s+=Array.from(el.labels).map(x=>x.innerText).join(" ")+" "; } catch {}
    const label=el.closest("label"); if(label)s+=" "+(label.innerText||"");
    return s.toLowerCase();
  };
  const setValue=(el,value) => {
    if(!el||!value)return false;
    const proto=el instanceof HTMLTextAreaElement?HTMLTextAreaElement.prototype:el instanceof HTMLSelectElement?HTMLSelectElement.prototype:HTMLInputElement.prototype;
    const setter=Object.getOwnPropertyDescriptor(proto,"value")?.set;
    if(!setter)return false;
    setter.call(el,value);el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));return true;
  };
  const verificationDetected=(fields) => {
    const fieldSignal=fields.some(el=>/one.?time|otp|verification.?code|auth.?code|phone.?code|captcha|recaptcha|hcaptcha|security.?challenge/.test(descriptors(el)+" "+labels(el)));
    const challenge=Boolean(document.querySelector('iframe[src*="captcha" i],iframe[title*="captcha" i],[class*="captcha" i],[id*="captcha" i],[data-sitekey]'));
    const text=/verify (your|this) (email|phone)|enter (the )?(code|otp) we sent|security check|complete the captcha/i.test((document.body?.innerText||"").slice(0,7000));
    return fieldSignal||challenge||text;
  };
  function bestForm(){
    const forms=Array.from(document.forms).filter(visible), candidates=forms.length?forms:[document.body];
    let best=null;
    for(const el of candidates){
      const fields=Array.from(el.querySelectorAll("input,textarea,select")).filter(visible);
      const passwords=fields.filter(f=>f instanceof HTMLInputElement&&f.type==="password");
      const text=((el.innerText||"").slice(0,5000)+" "+(el.getAttribute("aria-label")||"")).toLowerCase();
      const pathSignal=/sign.?up|register|registration|create.?account|join/i.test(location.pathname+" "+location.search);
      const confirm=passwords.some(f=>/confirm|repeat|re.?enter/.test(descriptors(f)+" "+labels(f)));
      const registerWords=/create (an? )?account|sign.?up|register|join now|create your account/.test(text);
      const loginWords=/forgot password|remember me|sign in|log in/.test(text);
      const score=(pathSignal?2:0)+(confirm?2:0)+(registerWords?2:0)-(loginWords&&!registerWords&&!confirm&&!pathSignal?3:0);
      const cand={form:el===document.body?null:el,fields,passwords,score};
      if(!best||cand.score>best.score||(cand.score===best.score&&passwords.length>best.passwords.length))best=cand;
    }
    return best;
  }
  const choose=(fields,re)=>fields.find(f=>re.test(descriptors(f)+" "+labels(f)));
  chrome.runtime.onMessage.addListener((message,sender,sendResponse)=>{
    if(message?.type!=="ACCOUNT_FORGE_FILL")return;
    try{
      const c=message.credentials||{}, best=bestForm();
      if(!best||!best.fields.length){sendResponse({ok:false,error:"No editable fields were found on this page."});return true;}
      const textOf=el=>descriptors(el)+" "+labels(el);
      const email=choose(best.fields,/email|e-mail/);
      const user=choose(best.fields,/username|user name|login name|handle|nickname/);
      const fullName=choose(best.fields,/(^|\s)(full.?name|display.?name|your name|first.?name|name)(\s|$)/);
      const mainPassword=best.passwords.find(f=>/password/.test(textOf(f))&&!/confirm|repeat|re.?enter|current|old/.test(textOf(f)))||best.passwords[0];
      const confirmation=best.passwords.find(f=>f!==mainPassword&&/confirm|repeat|re.?enter/.test(textOf(f)));
      const filled=[];
      if(email&&c.email&&setValue(email,c.email))filled.push("email");
      if(user&&setValue(user,c.username))filled.push("username");
      if(fullName&&c.displayName&&setValue(fullName,c.displayName))filled.push("name");
      if(mainPassword&&setValue(mainPassword,c.password))filled.push("password");
      if(confirmation&&setValue(confirmation,c.password))filled.push("confirm password");
      const challenge=verificationDetected(best.fields);
      const confident=best.score>=2&&best.passwords.length>0;
      let submitted=false;
      let messageText=filled.length?"Filled "+filled.join(", ")+".":"No matching fields were filled; use the copy buttons and enter them manually.";
      if(message.autoSubmit&&confident&&!challenge&&best.form){
        const submit=Array.from(best.form.querySelectorAll('button[type="submit"],input[type="submit"],button:not([type]),[role="button"]'))
          .filter(b=>visible(b)&&!b.disabled)
          .find(b=>/create account|sign.?up|register|join|create|continue/i.test((b.innerText||b.value||b.getAttribute("aria-label")||"").trim()));
        if(filled.includes("password")&&submit){submit.click();submitted=true;messageText+=" The detected registration form was submitted once.";}
        else messageText+=" A clear registration submit button was not found, so it was not submitted.";
      }else if(message.autoSubmit&&challenge)messageText+=" A verification or security challenge is present; submission was paused.";
      else if(message.autoSubmit&&!confident)messageText+=" This did not look clearly enough like a registration page, so it was not submitted.";
      else messageText+=" Review the page and submit it yourself.";
      sendResponse({ok:true,submitted,message:messageText});
    }catch(error){sendResponse({ok:false,error:String(error?.message||error)});}
    return true;
  });
})();