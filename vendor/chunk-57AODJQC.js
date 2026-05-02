import{a as K}from"/vendor/chunk-VEA7TSKX.js";import{a as Q}from"/vendor/chunk-NNKWDRRJ.js";import"/vendor/chunk-IJWVF3DZ.js";import"/vendor/chunk-6ZASGBG3.js";import{a as q}from"/vendor/chunk-WBNMRCFC.js";import"/vendor/chunk-7JRXYLGN.js";import"/vendor/chunk-2EA6AP55.js";import"/vendor/chunk-2U623LQV.js";import"/vendor/chunk-SWVBMAGP.js";import"/vendor/chunk-EDFEULDS.js";import"/vendor/chunk-LVNHDYDC.js";import"/vendor/chunk-4KD3ALIW.js";import"/vendor/chunk-NGMOFUAD.js";import"/vendor/chunk-QRR7ASQ2.js";import"/vendor/chunk-HUTXJXBW.js";import{B as H,C as J}from"/vendor/chunk-AUCTE3PT.js";import"/vendor/chunk-N4VKPBTW.js";import{M as L,Q as O,R as B,S as P,T as I,U as N,V as U,W as V,X,q as G}from"/vendor/chunk-RJXJTGWO.js";import"/vendor/chunk-W6YFAC77.js";import{H as C,K as j,b as o,d as h,o as Z}from"/vendor/chunk-XBYHYKN3.js";import"/vendor/chunk-3XDOZQYC.js";import"/vendor/chunk-Z54UZXMW.js";var Y=G.pie,D={sections:new Map,showData:!1,config:Y},u=D.sections,y=D.showData,fe=structuredClone(Y),he=o(()=>structuredClone(fe),"getConfig"),ue=o(()=>{u=new Map,y=D.showData,O()},"clear"),me=o(({label:e,value:a})=>{if(a<0)throw new Error(`"${e}" has invalid value: ${a}. Negative values are not allowed in pie charts. All slice values must be >= 0.`);u.has(e)||(u.set(e,a),h.debug(`added new section: ${e}, with value: ${a}`))},"addSection"),ve=o(()=>u,"getSections"),xe=o(e=>{y=e},"setShowData"),Se=o(()=>y,"getShowData"),ee={getConfig:he,clear:ue,setDiagramTitle:U,getDiagramTitle:V,setAccTitle:B,getAccTitle:P,setAccDescription:I,getAccDescription:N,addSection:me,getSections:ve,setShowData:xe,getShowData:Se},we=o((e,a)=>{K(e,a),a.setShowData(e.showData),e.sections.map(a.addSection)},"populateDb"),Ce={parse:o(async e=>{let a=await Q("pie",e);h.debug(a),we(a,ee)},"parse")},De=o(e=>`
  .pieCircle{
    stroke: ${e.pieStrokeColor};
    stroke-width : ${e.pieStrokeWidth};
    opacity : ${e.pieOpacity};
  }
  .pieOuterCircle{
    stroke: ${e.pieOuterStrokeColor};
    stroke-width: ${e.pieOuterStrokeWidth};
    fill: none;
  }
  .pieTitleText {
    text-anchor: middle;
    font-size: ${e.pieTitleTextSize};
    fill: ${e.pieTitleTextColor};
    font-family: ${e.fontFamily};
  }
  .slice {
    font-family: ${e.fontFamily};
    fill: ${e.pieSectionTextColor};
    font-size:${e.pieSectionTextSize};
    // fill: white;
  }
  .legend text {
    fill: ${e.pieLegendTextColor};
    font-family: ${e.fontFamily};
    font-size: ${e.pieLegendTextSize};
  }
`,"getStyles"),ye=De,$e=o(e=>{let a=[...e.values()].reduce((r,l)=>r+l,0),$=[...e.entries()].map(([r,l])=>({label:r,value:l})).filter(r=>r.value/a*100>=1);return j().value(r=>r.value).sort(null)($)},"createPieArcs"),Te=o((e,a,$,T)=>{h.debug(`rendering pie chart
`+e);let r=T.db,l=X(),A=J(r.getConfig(),l.pie),b=40,n=18,p=4,s=450,d=s,m=q(a),c=m.append("g");c.attr("transform","translate("+d/2+","+s/2+")");let{themeVariables:i}=l,[E]=H(i.pieOuterStrokeWidth);E??=2;let _=A.textPosition,g=Math.min(d,s)/2-b,te=C().innerRadius(0).outerRadius(g),ae=C().innerRadius(g*_).outerRadius(g*_);c.append("circle").attr("cx",0).attr("cy",0).attr("r",g+E/2).attr("class","pieOuterCircle");let f=r.getSections(),ie=$e(f),re=[i.pie1,i.pie2,i.pie3,i.pie4,i.pie5,i.pie6,i.pie7,i.pie8,i.pie9,i.pie10,i.pie11,i.pie12],v=0;f.forEach(t=>{v+=t});let k=ie.filter(t=>(t.data.value/v*100).toFixed(0)!=="0"),x=Z(re).domain([...f.keys()]);c.selectAll("mySlices").data(k).enter().append("path").attr("d",te).attr("fill",t=>x(t.data.label)).attr("class","pieCircle"),c.selectAll("mySlices").data(k).enter().append("text").text(t=>(t.data.value/v*100).toFixed(0)+"%").attr("transform",t=>"translate("+ae.centroid(t)+")").style("text-anchor","middle").attr("class","slice");let oe=c.append("text").text(r.getDiagramTitle()).attr("x",0).attr("y",-(s-50)/2).attr("class","pieTitleText"),R=[...f.entries()].map(([t,w])=>({label:t,value:w})),S=c.selectAll(".legend").data(R).enter().append("g").attr("class","legend").attr("transform",(t,w)=>{let M=n+p,de=M*R.length/2,pe=12*n,ge=w*M-de;return"translate("+pe+","+ge+")"});S.append("rect").attr("width",n).attr("height",n).style("fill",t=>x(t.label)).style("stroke",t=>x(t.label)),S.append("text").attr("x",n+p).attr("y",n-p).text(t=>r.getShowData()?`${t.label} [${t.value}]`:t.label);let ne=Math.max(...S.selectAll("text").nodes().map(t=>t?.getBoundingClientRect().width??0)),le=d+b+n+p+ne,W=oe.node()?.getBoundingClientRect().width??0,se=d/2-W/2,ce=d/2+W/2,z=Math.min(0,se),F=Math.max(le,ce)-z;m.attr("viewBox",`${z} 0 ${F} ${s}`),L(m,s,F,A.useMaxWidth)},"draw"),Ae={draw:Te},Me={parser:Ce,db:ee,renderer:Ae,styles:ye};export{Me as diagram};
