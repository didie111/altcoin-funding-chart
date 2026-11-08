(function(root){
 'use strict';
 function choose({host,title,message,details='',choices}){
  const doc=host.ownerDocument,dialog=doc.createElement('dialog');dialog.className='favorites-confirm';dialog.setAttribute('aria-labelledby','favoritesConfirmTitle');dialog.setAttribute('aria-describedby','favoritesConfirmMessage');
  const heading=doc.createElement('h2');heading.id='favoritesConfirmTitle';heading.textContent=title;const text=doc.createElement('p');text.id='favoritesConfirmMessage';text.textContent=message;const note=doc.createElement('p');note.className='favorites-confirm-note';note.textContent=details;
  const footer=doc.createElement('footer'),cancel=doc.createElement('button');cancel.type='button';cancel.textContent='취소';footer.append(cancel);
  const buttons=choices.map(choice=>{const b=doc.createElement('button');b.type='button';b.textContent=choice.label;b.dataset.choice=String(choice.value);if(choice.danger||choice.primary)b.className=choice.danger?'favorites-danger':'favorites-primary';footer.append(b);return b;});
  dialog.append(heading,text,note,footer);host.append(dialog);
  return new Promise(resolve=>{let finished=false;const finish=answer=>{if(finished)return;finished=true;if(dialog.open)dialog.close();dialog.remove();resolve(answer);};cancel.onclick=()=>finish(null);buttons.forEach((b,i)=>{b.onclick=()=>finish(choices[i].value);});dialog.addEventListener('close',()=>finish(null),{once:true});dialog.showModal();(buttons[choices.findIndex(c=>c.primary)]||cancel).focus();});
 }
 async function confirm({action='확인',danger=false,...context}){return Boolean(await choose({...context,choices:[{value:true,label:action,primary:!danger,danger}]}));}
 root.CoinFavoritesUI={confirm,choose};
})(globalThis);
