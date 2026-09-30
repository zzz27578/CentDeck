const filters=[...document.querySelectorAll('[data-filter]')];
filters.forEach(button=>button.addEventListener('click',()=>{
  filters.forEach(b=>{b.classList.toggle('active',b===button);b.setAttribute('aria-pressed',String(b===button));});
  let visible=0;document.querySelectorAll('[data-category]').forEach(card=>{card.hidden=button.dataset.filter!=='all'&&card.dataset.category!==button.dataset.filter;if(!card.hidden)visible++;});
  document.querySelector('.filter-status').textContent=`正在展示 ${visible} 个项目`;
}));
const dialog=document.getElementById('contact-dialog');
document.querySelectorAll('[data-contact]').forEach(button=>button.addEventListener('click',()=>dialog.showModal()));
dialog?.addEventListener('click',event=>{if(event.target===dialog){const r=dialog.getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)dialog.close();}});
document.getElementById('contact-form')?.addEventListener('submit',event=>{
  event.preventDefault();const values=new FormData(event.currentTarget);
  document.getElementById('form-status').textContent=`${values.get('name')}，你的咨询摘要已生成：${values.get('idea')}。联系邮箱：${values.get('email')}。此演示未发送任何数据。`;
});
