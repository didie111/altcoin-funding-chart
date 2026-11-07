(function(root){
 'use strict';
 function confirm({host,title,message,details='',action='확인',danger=false}){
  const doc=host.ownerDocument,dialog=doc.createElement('dialog');dialog.className='favorites-confirm';dialog.setAttribute('aria-labelledby','favoritesConfirmTitle');dialog.setAttribute('aria-describedby','favoritesConfirmMessage');
  const heading=doc.createElement('h2');heading.id='favoritesConfirmTitle';heading.textContent=title;const text=doc.createElement('p');text.id='favoritesConfirmMessage';text.textContent=message;const note=doc.createElement('p');note.className='favorites-confirm-note';note.textContent=details;
  const footer=doc.createElement('footer'),cancel=doc.createElement('button'),accept=doc.createElement('button');cancel.type=accept.type='button';cancel.textContent='취소';accept.textContent=action;accept.className=danger?'favorites-danger':'favorites-primary';footer.append(cancel,accept);dialog.append(heading,text,note,footer);host.append(dialog);
  return new Promise(resolve=>{let finished=false;const finish=answer=>{if(finished)return;finished=true;if(dialog.open)dialog.close();dialog.remove();resolve(answer);};cancel.onclick=()=>finish(false);accept.onclick=()=>finish(true);dialog.addEventListener('close',()=>finish(false),{once:true});dialog.showModal();(danger?cancel:accept).focus();});
 }
 root.CoinFavoritesUI={confirm};
})(globalThis);
