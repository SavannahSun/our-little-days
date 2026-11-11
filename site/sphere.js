export class WordSphere {
  constructor(container,onWord){
    this.container=container;this.onWord=onWord;this.points=[];this.angle=.15;this.frame=0;
    this.reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;this.paused=this.reduced;this.hover=false;this.visible=false;
    this.resize=new ResizeObserver(()=>this.draw());this.resize.observe(container);
    this.observer=new IntersectionObserver(entries=>{this.visible=entries.some(e=>e.isIntersecting);this.run();},{threshold:.05});this.observer.observe(container);
    container.addEventListener('pointerenter',()=>{this.hover=true;});
    container.addEventListener('pointerleave',()=>{this.hover=false;});
    container.addEventListener('focusin',()=>{this.hover=true;});
    container.addEventListener('focusout',()=>{this.hover=false;});
    this.visibility=()=>this.run();document.addEventListener('visibilitychange',this.visibility);
  }
  setWords(words){
    this.points=[];this.container.querySelectorAll('.sphere-word').forEach(n=>n.remove());
    const list=words.slice(0,matchMedia('(max-width:700px)').matches?42:52),max=Math.max(1,...list.map(x=>x.count));
    for(let i=0;i<list.length;i++){
      const word=list[i],y=1-2*(i+.5)/list.length,r=Math.sqrt(1-y*y),theta=i*Math.PI*(3-Math.sqrt(5));
      const button=document.createElement('button');button.className='sphere-word';button.textContent=word.word;
      button.title=word.word+' · '+word.count+' 次';button.setAttribute('aria-label','查看“'+word.word+'”的原话，词频 '+word.count+' 次');
      button.style.fontSize=(13+13*Math.sqrt(word.count/max))+'px';
      button.style.color=i%7===0?'#a77f65':'#4d6d41';
      button.addEventListener('click',()=>this.onWord(word));this.container.append(button);
      this.points.push({x:Math.cos(theta)*r,y,z:Math.sin(theta)*r,node:button});
    }
    this.draw();this.run();
  }
  draw(){
    const w=this.container.clientWidth,h=this.container.clientHeight,r=Math.min(w*.38,h*.39),c=Math.cos(this.angle),s=Math.sin(this.angle);
    for(const p of this.points){
      const xx=p.x*c+p.z*s,zz=-p.x*s+p.z*c,yy=p.y*.96+zz*.10;
      const scale=.78+(zz+1)*.20,opacity=.36+(zz+1)*.31;
      p.node.style.transform='translate(-50%,-50%) translate('+(w/2+xx*r)+'px,'+(h/2+yy*r)+'px) scale('+scale+')';
      p.node.style.opacity=String(opacity);p.node.style.zIndex=String(Math.round((zz+1)*100));
    }
  }
  run(){
    if(this.frame||this.paused||this.suspended||!this.visible||document.hidden)return;
    let last=0;
    const tick=now=>{
      this.frame=0;
      if(this.paused||this.suspended||!this.visible||document.hidden)return;
      if(!this.hover&&now-last>32){this.angle+=.0024;this.draw();last=now;}
      this.frame=requestAnimationFrame(tick);
    };
    this.frame=requestAnimationFrame(tick);
  }
  toggle(){this.paused=!this.paused;if(this.paused){cancelAnimationFrame(this.frame);this.frame=0;}else this.run();return this.paused;}
  suspend(value){this.suspended=value;if(value){cancelAnimationFrame(this.frame);this.frame=0;}else this.run();}
  destroy(){cancelAnimationFrame(this.frame);this.frame=0;this.resize.disconnect();this.observer.disconnect();document.removeEventListener('visibilitychange',this.visibility);this.points=[];this.container.querySelectorAll('.sphere-word').forEach(n=>n.remove());}
}
