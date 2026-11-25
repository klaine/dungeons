import{$r as e,A as t,Br as n,Ct as r,Jr as i,Tt as a,W as o,Xr as s,Yr as c,Zt as l,_r as u,ct as d,f,gr as p,lt as m,mr as h,on as g,or as _,p as v,rn as y,v as b,vn as x,zt as S}from"./BufferGeometryUtils-BRVHU7iX.js";import{t as C}from"./three.module-ehfymr6h.js";import{a as w,jt as T,s as E,st as D}from"./MarchingCubes-BuWCeiKJ.js";var{Break:O,Fn:k,If:A,Loop:ee,abs:j,attribute:te,cameraPosition:ne,clamp:M,cos:re,cross:ie,dFdx:ae,dFdy:oe,dot:N,exp:se,float:P,floor:F,fract:I,fwidth:ce,ivec2:le,length:L,materialRoughness:ue,max:R,min:z,mix:B,normalMap:de,normalView:fe,normalViewGeometry:pe,normalWorld:me,normalWorldGeometry:he,normalize:V,positionView:ge,positionWorld:_e,pow:ve,select:H,sin:ye,smoothstep:U,step:W,texture:G,transformNormalToView:be,time:xe,uniform:K,uv:Se,vec2:q,vec3:J,vec4:Ce,vertexColor:we}=T,Te={uNearRect:K(new s(0,0,0,0)),uNearBand:K(0)};function Ee(e){let t=Te.uNearRect,n=Te.uNearBand,r=_e.xz,i=z(z(r.x.sub(t.x),t.z.sub(r.x)),z(r.y.sub(t.y),t.w.sub(r.y))),a=z(R(i.div(R(n,.001)),0),1),o=Q(r.div(2.4)).mul(.65).add(Q(r.div(.85).add(7.3)).mul(.35)),s=H(a.greaterThanEqual(.999),P(2),a.mul(.7).add(.15)),c=n.greaterThan(0),l=H(c.and(i.greaterThanEqual(0)).and(o.greaterThanEqual(s)),P(0),P(1)),u=H(c.and(i.greaterThanEqual(0)).and(o.lessThan(s.sub(.06))),P(0),P(1));return{opacity:e===`near`?l:u,test:P(.5)}}var De=k(([e,t])=>{let n=q(0,0).toVar(),r=Y(U(.015,.05,L(ce(e)))),i=t.mul(r).toVar();return A(i.greaterThan(.01),()=>{for(let[t,r,a]of[[.55,1.3,1.7],[.33,1.7,8.9]]){let o=F(e.div(t)).toVar();for(let s=-1;s<=1;s++)for(let c=-1;c<=1;c++){let l=o.add(q(c,s)).toVar(),u=xe.mul(r).add(Z(l.add(q(a,a*1.3)))).toVar(),d=I(u),f=F(u).mul(.731).toVar(),p=l.add(q(Z(l.add(q(f,a+3.1))),Z(l.add(q(a+5.3,f)))).mul(.8).add(.1)).mul(t),m=W(Z(l.add(q(f.add(a+7.7),f))),i.mul(1.4)),h=e.sub(p),g=R(L(h),.001),_=g.sub(d.mul(t*1.1)).div(t*.11),v=ye(_.mul(2.4)).mul(se(_.mul(_).negate())).mul(Y(d).mul(Y(d)));n.addAssign(h.div(g).mul(v).mul(m).mul(.42))}}}),n}),Oe=(e,t)=>Ce(V(e).mul(M(t,0,1)).mul(.5).add(.5),1),ke={uNearEye:K(new s(0,0,0,0))};function Ae(e){let t=ke.uNearEye,n=_e.xz,r=M(t.z.sub(L(n.sub(t.xy))).div(R(t.w,.001)),0,1),i=Q(n.div(23)).mul(.65).add(Q(n.div(8.5).add(7.3)).mul(.35)),a=H(r.greaterThanEqual(.999),P(2),H(r.lessThanEqual(.001),P(-1),r.mul(.7).add(.15))),o=t.w.greaterThan(0),s=H(o.and(i.greaterThanEqual(a)),P(0),P(1)),c=H(o.and(i.lessThan(a.sub(.06))),P(0),P(1));return{opacity:e===`near`?s:c,test:P(.5)}}function je(e,t,n=`rect`){let r=n===`eye`?Ae(t):Ee(t);return e.opacityNode=r.opacity,e.alphaTestNode=r.test,e}var Me={uBake:K(0),uFallback:K(new c(.35,.4,.5))},Ne=Me.uBake,Pe=Me.uFallback,Fe={uWet:K(0)},Ie=Fe.uWet,Le=e=>Ie.mul(B(1,U(.12,.45,e.x),Ne)),Re=()=>[te(`aSHr`,`vec4`),te(`aSHg`,`vec4`),te(`aSHb`,`vec4`)],ze=()=>te(`aField`,`vec4`),Be=()=>te(`aBake`,`vec2`),Y=e=>P(1).sub(e),Ve=(e,t,n)=>e>t?Y(U(t,e,n)):U(e,t,n),He={uChips:K(1)},Ue={uEdges:K(1)},We=(e,t=!1,n=He.uChips)=>{let r=te(`aEdge`,`vec4`),i=ge,a=ae(i),o=oe(i),s=V(pe),c=ie(o,s),l=ie(s,a),u=N(a,c),d=u.add(H(u.greaterThanEqual(0),P(1e-14),P(-1e-14))),f=e=>c.mul(ae(e)).add(l.mul(oe(e))).div(d),p=f(r.x).toVar(),m=f(r.y).toVar(),h=p.add(m).toVar(),g=R(L(p),1e-4),_=R(L(m),1e-4),v=R(L(h),1e-4),y=W(.25,r.z).mul(W(r.z,.75)),b=W(.75,r.z),x=_e,S=M(n.sub(1).div(3),0,1),C=t?U(P(.6).sub(S.mul(.14)),P(.78).sub(S.mul(.1)),Q(q(x.x.mul(6.1).add(x.z.mul(4.7)),x.y.mul(6.3).add(x.x.mul(1.9)))).mul(.6).add(Q(q(x.z.mul(5.3).sub(x.y.mul(2.9)),x.x.mul(5.9).add(x.y.mul(4.1)))).mul(.4))).mul(z(n,1)).toVar():P(0),w=P(e).mul(C.mul(2).add(1)).toVar(),T=R(L(ce(i)),1e-5),E=R(w,T),D=U(.15,.6,w.div(T)).mul(Ue.uEdges),O=e=>B(ve(M(P(1).sub(e.div(E)),0,1),2),U(E,E.mul(.82),e).mul(.62),C),k=O(r.x.div(g)).mul(y.add(b)),A=O(P(1).sub(r.x).div(g)).mul(y),ee=O(r.y.div(_)).mul(y.add(b)),j=O(P(1).sub(r.y).div(_)).mul(y),ne=O(P(1).sub(r.x).sub(r.y).div(v)).mul(b),re=p.div(g).mul(A.sub(k)).add(m.div(_).mul(j.sub(ee))).add(h.div(v).mul(ne)).mul(D).toVar(),se=R(R(R(k,A),R(ee,j)),ne).mul(D),F=V(ge.negate());return{bend:e=>{let t=V(e.add(re)).toVar();return V(t.add(F.mul(R(P(.2).sub(N(t,F)),0))))},wear:se,chip:C.mul(W(.001,se)).mul(D)}},Ge=e=>{let[t,n,r]=Re(),i=Ce(1,e);return R(J(N(t,i),N(n,i),N(r,i)),0)},Ke=e=>Y(U(.004,.06,e.x)).mul(W(.55,e.y)),qe=(e,t)=>B(Pe.mul(P(.55).add(e.y.mul(.45))),Ge(e),R(Ne,Ke(t))),Je=class extends E{o;constructor(e){super(),this.o=e}direct(e,t){this.o.sun&&e.lightNode?.light?.isDirectionalLight&&(e={...e,lightColor:e.lightColor.mul(this.o.sun)}),super.direct(e,t)}indirect(e){let t=e.context;t.irradiance.assign(ot?this.o.irradiance.add(lt(_e,me).mul(U(.06,.12,Be().x))):this.o.irradiance),t.iblIrradiance.assign(J(0)),this.o.sky&&t.radiance.mulAssign(this.o.sky),super.indirect(e),this.o.gleam&&(t.reflectedLight.directSpecular.mulAssign(this.o.gleam),t.reflectedLight.indirectSpecular.mulAssign(this.o.gleam))}},Ye=(e,t)=>{e.setupLightingModel=()=>new Je(t)};function Xe(e,t,n={}){if(n.deep)return Ze(e,t,{...n,deep:n.deep});let r=n.unrepeat,a=n.wear??He.uChips,o=z(a,1).toVar(),s=M(a.sub(1).div(3),0,1).toVar(),c=new w({normalMap:r?null:e.normalMap,normalScale:new i(n.normalScale??1,n.normalScale??1),aoMap:r?null:e.ormMap,roughnessMap:r?null:e.ormMap,roughness:n.roughness??1,metalness:0,color:new b(1,1,1)}),l=ze(),u=Be(),d=r?$(e,r.span,r.courses):null,f=d?d.map:G(e.map,Se()),p=G(t.map,Se().mul(n.mossScale??1.7)),m=()=>d?d.normal:G(e.normalMap,Se());d&&(c.normalNode=de(d.normal,q(n.normalScale??1,n.normalScale??1)),c.aoNode=d.orm.r);let h=d?P(n.roughness??1).mul(d.orm.g):ue,g=R(l.y,Le(u).mul(.8)),_=B(.4,U(.03,.3,u.x).mul(Y(U(.2,.8,u.y).mul(.92))),Ne),v=U(0,.22,l.x.mul(_).mul(1.5).add(Y(f.a).mul(.4)).add(p.a.mul(.45)).sub(1)),y=f.rgb.mul(n.paint?J(...n.paint):we().rgb).mul(B(1,.5,g));if(d){let e=Se(),t=Q(e.div(2.4).add(q(4.4,2.6))).mul(.6).add(Q(e.div(.9).add(q(9.1,1.4))).mul(.28)).add(Q(e.div(.3).add(q(2.7,6.3))).mul(.12)).toVar();y=y.mul(B(.66,1.06,U(.22,.78,t))),y=y.mul(B(J(.93,.97,1.03),J(1.06,1,.9),U(.3,.7,Q(e.div(3.3).add(q(1.7,8.8))))))}y=B(y,p.rgb,v),y=B(y,J(.012),l.z.mul(.9));let x=W(500,j(l.w)),S=_e.y.sub(j(l.w).sub(1e3)).toVar(),C=_e.x.add(_e.z),T=null,E=null,D=_e,O=V(he),k=V(q(O.z.negate(),O.x).add(q(1e-4,0))),A=(d?Se().mul(2):q(N(D.xz,k),D.y)).toVar(),ee=U(.35,.8,Q(D.xz.div(17).add(5.3))).toVar();if(n.render){let e=z(ee.mul(.09).add(.012).add(Y(U(.25,1.4,S)).mul(.12)).mul(a),.9).mul(x).toVar(),t=Y(U(.004,.012,L(ce(A)))).toVar(),n=Q(X(A.mul(1.7)).add(11.3)).mul(.62).add(Q(X(A.mul(-5.9)).add(3.7)).mul(.27)).add(Q(X(A.mul(23)).add(1.9)).sub(.5).mul(.11).mul(t)).add(.055).toVar(),r=P(.77).sub(e.mul(.75)).toVar(),i=n.sub(r).toVar(),c=R(ce(n).mul(.8),.006).toVar(),l=U(c.negate(),c,i).mul(W(.004,e)).toVar(),u=U(.065,.1,i.add(Q(X(A.mul(9.1))).sub(.5).mul(.05))).mul(l).toVar(),d=gt(A.y.div(.076),P(3.1),.02),p=gt(A.x.div(.25).add(d.k.mul(.5)),d.k.add(7.7),.08),m=Y(U(.004,.007,z(z(p.at,Y(p.at)).mul(.25),z(d.at,Y(d.at)).mul(.076)))).toVar(),h=Z(q(p.k,d.k.add(2.2))),_=B(J(.5,.25,.16),J(.62,.36,.22),h).mul(B(.85,1.1,f.a)).mul(B(1,.7,Z(q(d.k,p.k.add(9.3))).mul(.6))),v=B(B(J(.41,.35,.26),J(.53,.46,.35),U(.3,.7,Q(X(A.mul(31))))).mul(B(.85,1.12,f.a)),B(_,J(.5,.48,.42),m),u),b=U(c.negate(),c,i).mul(Y(U(.006,.016,i))).mul(W(.004,e)).mul(t);y=y.mul(B(1,.92,U(-.05,0,i).mul(Y(l)).mul(W(.004,e)))),y=B(y,v.mul(B(1,.6,g)),l),y=B(y,J(.82,.8,.75).mul(B(1,.6,g)),b.mul(.75));let C=Q(X(A.mul(2.6)).add(17.7)).add(Q(X(A.mul(-11)).add(4.4)).mul(.22)).add(Q(X(A.mul(41)).add(8.1)).mul(.07)).toVar(),w=R(ce(C).mul(.9),1e-4),E=Y(U(w.mul(.6),w.mul(1.6),j(C.sub(.5)))).mul(U(.6,.72,Q(X(A.mul(3.3)).add(9.9)).mul(.6).add(Q(X(A.mul(.7)).add(2.3)).mul(.4)).add(ee.mul(.1)))).mul(Y(U(4,11,L(ge)))).mul(Y(l)).mul(x).mul(o.add(s.mul(1.5)));y=y.mul(Y(E.mul(.2)));let D=l.mul(-.015).sub(u.mul(.004)).sub(m.mul(u).mul(.004)).mul(Y(U(5,12,L(ge)))).toVar(),O=ge,k=ae(O),te=oe(O),ne=V(pe),M=ie(te,ne),re=ie(ne,k),se=N(k,M),F=M.mul(ae(D)).add(re.mul(oe(D))).mul(H(se.greaterThanEqual(0),P(1),P(-1))),I=F.mul(z(1,j(se).div(R(L(F),1e-12))));T=e=>V(e.mul(R(j(se),1e-12)).sub(I).div(R(j(se),1e-12)))}if(n.bond){let e=Se(),t,r,i,c,l;if(n.bond===`wendish`){t=F(e.y.mul(20)),l=I(e.y.mul(20));let n=e.x.mul(15).add(t.mul(3).mod(5)),i=n.mod(5),a=H(i.lessThan(2),P(0),H(i.lessThan(4),P(2),P(4))),o=H(i.lessThan(4),P(2),P(1));r=F(n.div(5)).mul(5).add(a),c=i.sub(a).div(o)}else{t=F(e.y.mul(26)),l=I(e.y.mul(26));let n=e.x.mul(9).add(t.mod(2).mul(.5));r=F(n),c=I(n)}i=q(r,t);let u=x.mul(a).toVar(),d=x.mul(o).toVar(),p=U(.38,.5,f.a).toVar(),m=Y(p),h=W(Z(i.add(q(3.3,7.1))),ee.mul(.07).add(.03).add(Y(U(.3,1.6,S)).mul(.1))).mul(u),g=Q(q(c.mul(3.1),l.mul(1.3)).add(Z(i).mul(17))).toVar(),_=U(.4,.46,g).mul(h).mul(p).toVar(),v=U(.38,.4,g).mul(Y(U(.4,.43,g))).mul(h).mul(p);y=B(y,y.mul(J(1.5,1.2,.92)).mul(B(.8,1.1,Q(e.mul(220)))),_.mul(.9)).mul(Y(v.mul(.5)));let b=U(P(.58).sub(s.mul(.3)),P(.74).sub(s.mul(.25)),Q(X(A.mul(2.3)).add(6.1)).add(ee.mul(.12)).add(Y(U(.2,1.2,S)).mul(.2))).mul(d).toVar();y=y.mul(Y(m.mul(b).mul(.62)));let C=Y(U(.2,.85,S.add(Q(X(A.mul(4.1))).sub(.5).mul(.35)))).mul(U(.55,.75,Q(X(A.mul(3.3)).add(2.2)))).mul(U(.3,.7,Q(X(A.mul(27)).add(5.5)))).mul(d);y=B(y,J(.74,.72,.68).mul(B(.85,1,f.a)),C.mul(B(.12,.5,m)))}let te=null;if(n.timber){let e=Se(),t=x.mul(o).toVar(),n=x.mul(a).toVar(),r=W(l.w,-500).toVar(),i=Y(r),c=e=>N(e,J(.3,.55,.15)),u=B(f.rgb,J(c(f.rgb)),.78).mul(J(.92,.92,.9)).toVar(),d=U(-.3,.9,O.y).toVar(),p=U(.35,.7,Q(q(e.x.mul(.9),e.y.mul(7)).add(2.1))).toVar(),m=J(c(y)).mul(J(1.06,1.02,.96)).mul(2.1).add(J(.03,.028,.025));y=B(y,m,t.mul(i).mul(B(.12,.6,d)).mul(ee.mul(.5).add(.5)).mul(p.mul(.6).add(.4)));let h=e.y.mul(17).add(Q(q(e.x.mul(1.1),4.4)).mul(.6)).toVar(),_=R(ce(h).mul(.8),.02),v=Y(U(_,_.mul(2),j(I(h).sub(.5)))).mul(W(.66,Q(q(e.x.mul(1.7),F(h).mul(3.7))))).mul(Y(U(4,12,L(ge))));y=y.mul(Y(v.mul(t).mul(.55)));let b=Y(U(.1,P(.45).add(s.mul(.9)),S.add(Q(q(e.x.mul(7),e.y.mul(3))).sub(.5).mul(.15)))).mul(t);y=B(y,J(.045,.045,.03).mul(B(.8,1.2,f.a)),b.mul(.6)),y=B(y,y.mul(1.12).add(J(c(y)).mul(.25)).add(.012),t.mul(r).mul(B(.25,.6,d)).mul(ee.mul(.6).add(.4)));let C=z(ee.mul(.07).add(.015).add(Y(U(.2,1.1,S)).mul(.14)).add(d.mul(.05)).mul(n),.75).mul(r).toVar(),w=Q(q(e.x.mul(6.3),e.y.mul(29)).add(8.8)).mul(.65).add(Q(q(e.x.mul(19),e.y.mul(83)).add(1.3)).mul(.35)).toVar(),T=P(.8).sub(C).toVar(),D=R(ce(w).mul(.8),.004),k=U(T.sub(D),T.add(D),w).mul(W(.002,C)).toVar(),A=U(T.sub(.03),T.sub(.005),w).mul(Y(k)).mul(W(.002,C));y=B(y,u.mul(B(1,.6,g)),k),y=y.mul(B(1,1.18,A)),te=e=>e.mul(t).mul(r).mul(p.mul(.5).add(.5)),E=u}let ne=P(0);if(n.roof){let e=y,t=Se(),n=F(t.y.mul(8)),r=q(F(t.x.mul(6).add(I(n.mul(.5)))),n).toVar(),i=Z(r.add(q(1.7,3.1))),c=Z(r.add(q(5.3,9.7))),l=Z(r.add(q(8.1,2.9))),u=Z(r.add(q(4.6,7.4))),d=Y(U(.35,.9,L(ce(t.mul(q(6,8)))))).toVar(),m=U(.2,-.6,O.z).toVar(),h=U(.25,.5,O.y).toVar(),_=Q(D.xz.div(4.3).add(7.7)).toVar(),v=ee.mul(.6).add(Q(D.xz.div(9.1).add(1.9)).mul(.4)).add(s.mul(.7)).toVar(),b=W(.64,_).mul(W(.4,c)).toVar(),x=Y(b);y=y.mul(B(1,B(.78,1.14,i),d)).mul(B(J(1),J(.9,.84,.78),W(.72,l).mul(d))),y=B(y,y.mul(J(1.2,1.07,.9)),b.mul(d).mul(.85)),y=y.mul(B(1,.8,v.mul(x).mul(h)));let S=Y(U(.2,.55,f.a)),C=U(.4,.8,Q(D.xz.div(1.4).add(3.9)).mul(.6).add(m.mul(.5)).add(v.mul(.3)).sub(.12)).mul(h).mul(x).toVar(),w=Q(X(t.mul(17)).add(6.2)).mul(.65).add(Q(X(t.mul(-52)).add(2.4)).mul(.35)),T=U(.42,.62,S.mul(C).mul(.9).add(C.mul(w).mul(m.mul(.5).add(.25)))).toVar();y=B(y,p.rgb.mul(J(.8,.95,.6)).mul(B(.75,1.15,w)).mul(B(1,.6,g)),T.mul(.92));let E=Q(X(t.mul(21)).add(3.3)).mul(.7).add(Q(X(t.mul(-67)).add(1.1)).mul(.3)).toVar(),k=P(.84).sub(v.mul(.12).add(Y(m).mul(.04)).mul(h).mul(x)).toVar(),A=U(k,k.add(.03),E).mul(U(.2,.4,f.a)).mul(h).mul(x).mul(d.mul(.6).add(.4)).toVar(),j=U(.55,.62,Q(X(t.mul(3.1)).add(5.5)).add(Y(m).mul(.08)));y=B(y,B(J(.4,.4,.34),J(.52,.36,.1),j).mul(B(.85,1.1,E)).mul(B(1,.6,g)),A.mul(.6));let te=U(.55,.82,Q(q(N(D.xz,q(O.z,O.x.negate())).mul(2.1),D.y.mul(.35)).add(2.2))).mul(m.mul(.7).add(.3)).mul(v).mul(h).mul(x);y=y.mul(Y(te.mul(.38)));let M=W(P(.9985).add(Y(v).mul(.002)).sub(s.mul(.04)),u).mul(U(.15,.3,f.a)).mul(h).mul(d);y=B(y,J(.03,.024,.02),M),y=B(e,y,z(a,1)),ne=R(T,A.mul(.7)).mul(o)}if(n.weather){let e=U(.52,.8,Q(q(A.x.mul(2.4),A.y.mul(.16)).add(1.3)).mul(.75).add(Q(q(A.x.mul(9.1),A.y.mul(.5)).add(4.4)).mul(.25)));y=y.mul(Y(e.mul(ee.mul(d?.2:.14).add(d?.2:.12)).mul(x).mul(o.add(s.mul(1.2)))));let t=U(.25,.75,Q(q(A.x.mul(.45),A.y.mul(.3)).add(7.3))).mul(.6).add(.4).mul(s).mul(x).toVar();y=B(y,J(N(y,J(.3,.55,.15))).mul(J(.95,.93,.88)),t.mul(.45)).mul(Y(t.mul(.32)));let n=Y(U(.15,s.mul(1.6).add(.5),S)),r=U(.72,.84,Q(X(A.mul(.9)).add(3.3)).mul(.65).add(Q(X(A.mul(3.7)).add(8.8)).mul(.35)).add(n.mul(.42)).sub(f.a.sub(.5).mul(.2))).mul(s).mul(x).toVar();y=B(y,p.rgb.mul(J(.62,.78,.45)).mul(B(1,.6,g)),r.mul(B(.75,.45,f.a)))}let re=Q(q(C.mul(.9),3.1)).mul(.6).add(Q(q(C.mul(4.3),_e.y.mul(.7))).mul(.2)).add(.42).toVar(),se=S.sub(re).add(f.a.sub(.5).mul(.22)).toVar(),le=Y(U(-.12,.06,se)).mul(x).toVar(),fe=Y(U(0,.07,j(se.add(.03)))).mul(x),me=Y(U(.04,.38,S.add(Q(q(C.mul(11),_e.y.mul(11))).sub(.5).mul(.14)))).mul(x);y=y.mul(B(J(1,1,1),J(.74,.77,.72),le)).mul(Y(fe.mul(.1))),y=B(y,y.mul(J(.5,.46,.4)),me.mul(.55));let ve=et(_e,V(he).y.add(Y(f.a).mul(.1))).mul(U(.3,.55,u.x)).mul(Ne).toVar();if(y=B(y,J(...tt),ve),n.bevel){let e=We(n.bevel,!!n.chips,a);y=y.mul(e.wear.mul(.12).add(1)).mul(e.chip.mul(.16).add(1)),te&&(y=B(y,E,M(te(R(e.wear.mul(.75),e.chip)),0,1))),c.normalNode=e.bend(de(m(),q(n.normalScale??1,n.normalScale??1)))}return T&&(c.normalNode=T(de(m(),q(n.normalScale??1,n.normalScale??1)))),c.colorNode=Ce(y,1),c.roughnessNode=B(B(h.mul(B(1,.42,g.mul(Y(v)))),.97,R(R(v,l.z),ne)),.66,ve),Ye(c,{irradiance:qe(he,u),sun:Y(Ke(u)),sky:B(.3,U(0,.5,u.x),Ne),gleam:n.matt?P(.12):void 0}),n.fades?je(c,n.fades):c}function Ze(e,t,n){let r=new w({roughness:n.roughness??1,metalness:0,color:new b(1,1,1)}),i=ze(),a=Be(),o=ae(ge),s=oe(ge),c=ae(Se()),l=oe(Se()),u=V(pe).toVar(),d=s.cross(u),f=u.cross(o),p=V(d.mul(c.x).add(f.mul(l.x))),m=V(d.mul(c.y).add(f.mul(l.y))),h=V(ge.negate()),g=Y(U(5,13,L(ge))),_=k(()=>{let t=q(Se()).toVar();return A(g.greaterThan(0),()=>{let r=q(N(h,p),N(h,m)).div(R(N(h,u),.32)).mul(n.deep).mul(g).toVar(),i=P(0).toVar();ee(10,()=>{let t=G(e.map,Se().sub(r.mul(i))).level(0).a;A(Y(t).lessThanEqual(i),()=>{O()}),i.addAssign(1/10)}),t.subAssign(r.mul(i))}),t})().toVar(),v=G(e.map,_).toVar(),y=G(e.ormMap,_).toVar(),x=G(t.map,Se().mul(n.mossScale??1.7)),S=R(i.y,Le(a).mul(.8)),C=B(.4,U(.03,.3,a.x).mul(Y(U(.2,.8,a.y).mul(.92))),Ne),T=U(0,.22,i.x.mul(C).mul(1.5).add(Y(v.a).mul(.4)).add(x.a.mul(.45)).sub(1)),E=B(1-.5*(n.hollow??1),1,U(.05,.45,v.a)),D=v.rgb.mul(we().rgb).mul(B(1,.5,S)).mul(E);D=B(D,x.rgb,T),D=B(D,J(.012),i.z.mul(.9)),r.colorNode=Ce(D,1),r.roughnessNode=B(P(n.roughness??1).mul(y.g).mul(B(1,.42,S.mul(Y(T)))),.97,R(T,i.z)),r.aoNode=y.r;let j=G(e.normalMap,_).xyz.mul(2).sub(1);return r.normalNode=de(J(j.xy.mul(n.normalScale??1),j.z).mul(.5).add(.5)),Ye(r,{irradiance:qe(he,a).mul(B(1-.4*(n.hollow??1),1,U(.05,.5,v.a))),sun:Y(Ke(a)),sky:B(.3,U(0,.5,a.x),Ne),gleam:n.matt?P(.12):void 0}),r}var Qe={uSnow:K(0),uSnowLine:K(new i(0,0)),uSnowWinter:K(new i(1e6,60))},$e=e=>R(Qe.uSnow,U(Qe.uSnowWinter.x,Qe.uSnowWinter.x.add(Qe.uSnowWinter.y),e.y)),et=(e,t)=>{let n=$e(e).toVar(),r=Qe.uSnowLine,i=Pt(e.xz.mul(.045).add(3.7)),a=Q(e.xz.mul(.85)),o=U(r.x,r.x.add(35),e.y).mul(r.y),s=B(1,U(r.x.sub(10),r.x.add(8),e.y),W(.001,r.y));return U(0,.12,B(-1.15,.75,n).add(o).add(t.sub(.8).mul(2.4)).add(i.sub(.5).mul(1.5)).add(a.sub(.5).mul(.35))).mul(W(.001,n)).mul(s)},tt=[.79,.83,.9],nt={uGrassRange:K(80),uSward:K(new c(.225,.3,.066)),uBare:K(new s(1,1,1,0))},rt=new t(new Float32Array(4),1,1,x,o);rt.magFilter=rt.minFilter=l,rt.generateMipmaps=!1,rt.needsUpdate=!0;var it=G(rt),at={uLamps:K(new s(0,0,1/8,0)),uLampSize:K(new i(1,1))},ot=!1,st=8;function ct(e,t,n=!0){if(ot=!!e?.length&&n&&t>0,!ot||!e){at.uLamps.value.w=0;return}let r=Math.min(...e.map(e=>e[0]))-16,i=Math.min(...e.map(e=>e[2]))-16,a=Math.ceil((Math.max(...e.map(e=>e[0]))-r)/st)+3,o=Math.ceil((Math.max(...e.map(e=>e[2]))-i)/st)+3,s=new Float32Array(a*o*4);for(let[t,n,o]of e){let e=(Math.floor((o-i)/st)*a+Math.floor((t-r)/st))*4;s[e+3]===0&&s.set([t,n,o,1],e)}rt.dispose(),rt.image={data:s,width:a,height:o},rt.needsUpdate=!0,at.uLamps.value.set(r,i,1/st,t),at.uLampSize.value.set(a,o)}var lt=(e,t)=>{let n=at.uLamps,r=at.uLampSize,i=F(e.xz.sub(n.xy).mul(n.z)).toVar(),a=P(0);for(let n=-1;n<=1;n++)for(let o=-1;o<=1;o++){let s=it.load(le(M(i.add(q(o,n)),q(0,0),r.sub(1)))).toVar(),c=s.xyz.sub(e),l=R(N(c,c),.01),u=M(Y(l.div(64)),0,1),d=B(1,.06,U(-.2,1.6,e.y.sub(s.y)));a=a.add(s.w.mul(u.mul(u)).mul(d).div(l.mul(.6).add(1)).mul(R(N(t,c.mul(l.inverseSqrt())),0).mul(.85).add(.15)))}return J(1,.6,.28).mul(a).mul(n.w)},ut=new t(new Float32Array(4),1,1,x,o);ut.magFilter=ut.minFilter=l,ut.generateMipmaps=!1,ut.needsUpdate=!0;var dt=G(ut),ft={uPave:K(new s(0,0,1,0)),uPaveSize:K(new i(1,1)),uSun:K(new c(.5,.6,.6)),uPaveTurn:K(new s(0,0,0,0)),uPaveRot:K(new i(1,0))};function pt(e,t=!0,n){mt=!!e&&t,ft.uPaveTurn.value.set(n?.u??0,n?.v??0,n?.hx??0,n?.hz??0),ft.uPaveRot.value.set(Math.cos(n?.turn??0),Math.sin(n?.turn??0)),!e||!t?ft.uPave.value.set(0,0,1,0):(ut.dispose(),ut.image={data:e.data,width:e.nx,height:e.nz},ut.needsUpdate=!0,ft.uPave.value.set(e.x0,e.z0,1/e.cell,1),ft.uPaveSize.value.set(e.nx,e.nz))}var mt=!1,ht=e=>{if(!mt)return{c:e.x.negate(),a:e.y,d:q(0,1),e:q(-1,0),id:P(0)};let t=ft.uPave,n=ft.uPaveSize,r=ft.uPaveTurn,i=ft.uPaveRot,a=e.sub(r.xy),o=q(r.z.add(i.x.mul(a.x)).add(i.y.mul(a.y)),r.w.sub(i.y.mul(a.x)).add(i.x.mul(a.y))).toVar(),s=e=>q(i.x.mul(e.x).sub(i.y.mul(e.y)),i.y.mul(e.x).add(i.x.mul(e.y))),c=o.sub(t.xy).mul(t.z).toVar(),l=F(c).toVar(),u=c.sub(l).toVar(),d=e=>dt.load(le(M(e,q(0,0),n.sub(1)))),f=d(F(c.add(.5))).w.toVar(),p=q(0,0),m=q(0,0),h=P(0);for(let[e,n]of[[0,0],[1,0],[0,1],[1,1]]){let r=l.add(q(e,n)),i=d(r).toVar(),a=o.sub(r.div(t.z).add(t.xy)),s=q(re(i.z),ye(i.z)),c=q(s.y.negate(),s.x),g=(e?u.x:Y(u.x)).mul(n?u.y:Y(u.y)).mul(W(j(i.w.sub(f)),.5));p=p.add(q(i.y.add(N(a,c)),i.x.add(N(a,s))).mul(g)),m=m.add(s.mul(g)),h=h.add(g)}let g=W(.5,f).mul(t.w).toVar(),_=p.div(R(h,1e-6)).toVar(),v=V(m.add(q(1e-6,0))).toVar();return{c:B(e.x.negate(),_.x,g),a:B(e.y,_.y,g),d:B(q(0,1),s(v),g),e:B(q(-1,0),s(q(v.y.negate(),v.x)),g),id:f.mul(g)}},X=e=>q(e.x.mul(.8).sub(e.y.mul(.6)),e.x.mul(.6).add(e.y.mul(.8))),gt=(e,t,n)=>{let r=F(e).toVar(),i=e=>e.add(Z(q(e,t)).sub(.5).mul(P(n).mul(2))),a=i(r).toVar(),o=i(r.add(1)).toVar(),s=e.lessThan(a),c=e.greaterThanEqual(o),l=H(s,i(r.sub(1)),H(c,o,a)).toVar(),u=H(s,a,H(c,i(r.add(2)),o)).toVar();return{k:H(s,r.sub(1),H(c,r.add(1),r)),at:e.sub(l).div(u.sub(l)),size:u.sub(l)}},_t=(e,t,n,r)=>{let i=B(.14,.55,n),a=B(.17,.9,n),o=I(e.div(2.2).add(.5)).sub(.5),s=gt(t.sub(r.mul(1).mul(P(.25).sub(o.mul(o)))).div(i),P(17.31),B(.2,.3,n)),c=gt(e.div(a).add(Z(q(s.k,5.17)).mul(9.7)),s.k.add(31.7),B(.32,.36,n)),l=c.at.toVar(),u=s.at.toVar();return{id:q(c.k,s.k),ex:z(l,Y(l)).mul(c.size).mul(a),ez:z(u,Y(u)).mul(s.size).mul(i),lx:l,lz:u}},vt=(e,t,n,r,i)=>{let a=_t(e.x,e.y,t,n),o=Z(a.id.add(q(r.mul(13.1),.5))).toVar(),s=B(.028,B(.035,.09,o),t),c=a.ex.lessThan(s).and(a.ez.lessThan(s)),l=Q(X(e.mul(B(41,17,t))).add(o.mul(17))).sub(.5).mul(B(.014,.012,t)).mul(i);return{sto:a,edge:H(c,s.sub(L(q(s.sub(a.ex),s.sub(a.ez)))),z(a.ex,a.ez)).add(l).toVar(),inCorner:c,rc:s,tone:o}},yt=(e,t,n)=>{let r=U(n.mul(.5),n.add(B(.026,.03,t)),e.edge);return B(.18,B(.8,1,Y(e.sto.lx.sub(.5).mul(e.sto.lx.sub(.5)).add(e.sto.lz.sub(.5).mul(e.sto.lz.sub(.5))).mul(2))).mul(B(1,B(.72,1,e.tone),t)),r)},bt=(e,t,n,r,i,a)=>{let o=e.div(t),s=F(o),c=I(o),l=q(Z(s.add(a+1.7)),Z(s.add(a+3.1))).mul(.5).add(.25),u=B(r/t,i/t,Z(s.add(a+5.3)));return Y(U(.75,1,L(c.sub(l)).div(u).add(Q(X(e.mul(90).add(a))).sub(.5).mul(.35)))).mul(W(Z(s.add(a)),n))};function xt(e,t,n,r,i,a,o=2.3,s=`rect`){let c=new w({roughness:.96,metalness:0,color:new b(1,1,1)}),l=ze(),u=Be(),d=_e.xz,f=L(ge),p=U(70,260,f).mul(5),m=t=>G(e.map,t),h=m(d.div(41).add(.37)).a,g=m(d.div(9.7).add(.11)).a,_=m(d.div(5.3).add(.61)).a.sub(.5),v=j(l.x.sub(100).add(_.mul(.34))).add(g.sub(.5).mul(.3)),y=Y(U(3,8,ce(l.x).div(L(ce(d)).add(1e-4)))).toVar(),x=W(150,l.x).mul(y),S=W(50,l.x).mul(W(l.x,150)).mul(y),C=W(l.w,-.5),T=W(l.w,-1.5),E=l.x.negate().sub(300).toVar(),D=U(-.04,.04,E).mul(W(l.x,-250)).toVar(),te=J(0,0,0).toVar(),ie=J(0,0,1).toVar(),se=P(.9).toVar(),le=P(1).toVar(),ue=P(0).toVar(),pe=L(ce(d)).mul(1.2).add(.002).toVar(),me=Y(U(.3,1.6,E)).toVar(),ve=k(()=>(te.assign(J(0,0,0)),ie.assign(J(0,0,1)),se.assign(.9),le.assign(1),ue.assign(0),A(D.greaterThan(0),()=>{let e=ht(d),t=W(.5,e.id).mul(W(e.id,1e3)),n=t.mul(W(.5,Z(q(e.id,2.71)))).mul(Y(C)),r=Y(U(B(16,36,C),B(55,130,C),f)).toVar(),i=B(.0105,.006,C),a=Y(U(7,13,f)).mul(W(.01,D)).mul(Y(T)).toVar(),o=B(.024,.012,C),s=t=>yt(vt(t,C,n,e.id,P(1)),C,i),c=k(()=>{let t=q(e.c,e.a),n=q(t).toVar();return A(a.greaterThan(0),()=>{let r=V(ne.sub(_e)),i=r.xz.div(R(r.y,.22)),c=q(N(i,e.e),N(i,e.d)).mul(o).mul(a).toVar(),l=P(0).toVar(),u=P(0).toVar();ee(8,()=>{A(Y(s(t.sub(c.mul(l)))).lessThanEqual(l),()=>{O()}),u.assign(l),l.addAssign(1/8)});let d=u.add(l).mul(.5);l.assign(H(Y(s(t.sub(c.mul(d)))).lessThanEqual(d),d,l)),n.assign(t.sub(c.mul(l)));let f=ft.uSun;A(f.y.greaterThan(.05),()=>{let t=f.xz.div(R(f.y,.12)),r=q(N(t,e.e),N(t,e.d)).mul(o).toVar(),i=s(n).add(.03).toVar();for(let e of[.2,.45,.75,1]){let t=R(Y(i),.05).mul(e);le.assign(z(le,U(-.04,.06,i.add(t).sub(s(n.add(r.mul(t)))))))}le.assign(B(1,le,a))})}),n})().toVar(),l=vt(c,C,n,e.id,r),u=l.sto,p=l.edge,m=l.inCorner,_=l.rc,v=l.tone,y=Z(u.id.add(q(7.3,e.id.mul(3.7)))).toVar(),b=Z(u.id.add(q(1.7,e.id.add(9.1)))).toVar(),x=Y(U(i,i.add(pe),p)).mul(r).add(Y(r).mul(.1)).toVar(),S=U(1.2,2.8,E).mul(t).toVar();te.assign(k(()=>{let e=B(H(b.lessThan(.3),J(.96,.97,1.02),H(b.lessThan(.5),J(1.12,.97,.9),H(b.lessThan(.65),J(1,.8,.72),H(b.lessThan(.82),J(.74,.79,.86),J(1.2,1.17,1.1))))),H(b.lessThan(.35),J(.93,.96,1.02),H(b.lessThan(.7),J(1.07,1,.9),H(b.lessThan(.88),J(.8,.8,.82),J(1.12,1.08,1)))).mul(B(J(.97,.99,1.02),J(1.03,1,.97),y)),C),t=q(v.mul(37.1),y.mul(53.7)),n=c,a=Y(U(3,9,f)),o=U(.25,.75,Q(X(n.mul(71)).add(t.yx))).mul(.6).add(U(.3,.7,Q(X(n.mul(-43)).add(t))).mul(.4)),s=U(.25,.75,Q(X(n.mul(B(11,4.5,C))).add(t))),l=U(.2,.8,Q(X(n.mul(B(3.1,1.3,C))).add(t.mul(1.3)))),d=B(.8,1,U(.01,B(.05,.14,C),p)),m=B(1,B(.82,1.16,o),a.mul(.8).add(.2)).mul(B(.84,1.1,s)).mul(B(.8,1.08,l)).mul(d),_=B(1,1.07,S.mul(U(.02,.05,p))),w=Y(S.mul(.8)).mul(C),T=bt(n,.13,w.mul(B(.18,.4,me)),.016,.048,11).mul(a.mul(.6).add(.4)),E=bt(n,.09,w.mul(.07),.005,.014,27),D=y.mul(3.1416),O=Y(U(.003,.009,j(N(q(u.lx.sub(.5),u.lz.sub(.5)),q(re(D),ye(D))).sub(v.sub(.5).mul(.5)).add(Q(X(n.mul(19))).sub(.5).mul(.06))))).mul(W(Z(u.id.add(q(5.5,1.3))),.09)).mul(C).mul(r).mul(.7),k=we().rgb.mul(B(J(1,1,1),e.mul(B(B(.82,1.14,v),B(.76,1.18,v),C)).mul(m).mul(_),r)).mul(B(.9,1.08,h)).mul(B(J(1,1,1),J(1.12,1.15,.98),T.mul(.7))).mul(Y(E.mul(.35))).mul(Y(O.mul(.6))),A=B(J(.2,.18,.15),J(.4,.35,.28),Q(X(n.mul(23)))).mul(B(.6,.85,S)).mul(B(.55,1,U(0,i,p))),ee=U(.45,.75,g.add(h.sub(.5).mul(.8)).add(me.mul(.35)).sub(S.mul(.4)));return B(k,B(B(A,k.mul(J(.32,.3,.27)),C),J(.05,.075,.03),ee.mul(.75)),x)})()),ie.assign(k(()=>{let t=B(.026,.03,C),n=B(.013,.005,C),a=M(p.sub(i).div(t),0,1),o=a.mul(Y(a)).mul(6).div(t).mul(n).mul(W(i,p)).mul(r).toVar(),s=H(u.lx.lessThan(.5),P(-1),P(1)),c=H(u.lz.lessThan(.5),P(-1),P(1)),l=H(m,V(q(s.mul(_.sub(u.ex)),c.mul(_.sub(u.ez))).add(1e-5)),H(u.ex.lessThan(u.ez),q(s,0),q(0,c))),d=q(u.lx.sub(.5),u.lz.sub(.5)).mul(B(.16,.035,C)),f=q(Z(u.id.add(q(41.3,2.9))),Z(u.id.add(q(3.1,61.7)))).sub(.5).mul(B(.12,.07,C)),h=l.mul(o).add(d.add(f).mul(r).mul(Y(x)));return J(e.e.mul(h.x).add(e.d.mul(h.y)),1)})()),se.assign(B(B(B(.66,.5,S),.95,x),B(.82,.6,S),C));let w=U(.29,.23,Q(X(c.div(3.7)).add(8.3)).mul(.75).add(Q(X(c.mul(.9)).add(4.1)).mul(.25)).sub(S.mul(.04)));ue.assign(R(x.mul(B(.35,.2,C)),w))}),te))().toVar(),be=j(l.x.sub(200)).add(_.mul(.22)).toVar(),xe=Y(U(.22,.5,be.add(g.sub(.5).mul(.25)))).mul(x).toVar(),K=Y(U(0,.34,j(v.sub(.58)).sub(.2).sub(_.mul(.14)))).toVar(),Se=Y(U(0,.16,j(v.sub(.58)).sub(.08).sub(_.mul(.08)))).mul(S).toVar(),Te=ye(d.y.mul(.9).add(ye(d.y.mul(.31)).mul(2.2))),Ee=R(H(S.greaterThan(.5),R(l.z,R(K,Ve(-.15,-.35,Te).mul(Y(U(.25,.5,v))))),l.z),xe.mul(.85)).toVar(),ke=R(l.y,Le(u).mul(.7)),Ae=l.w,Me=R(U(.2,.55,ke.add(g.sub(.5).mul(.3))),nt.uBare.w.mul(U(.25,.6,g.add(h.sub(.5).mul(.6))).mul(.6).add(.4))).toVar(),Pe=Y(U(6,14,f)),Fe=ae(d),Re=oe(d),He=ae(v),Ue=oe(v),We=Fe.x.mul(Re.y).sub(Fe.y.mul(Re.x)),Ge=We.add(H(We.greaterThanEqual(0),P(1e-12),P(-1e-12))),Je=q(He.mul(Re.y).sub(Ue.mul(Fe.y)),Fe.x.mul(Ue).sub(Re.x.mul(He))).div(Ge),Xe=Je.mul(z(1,P(1.2).div(R(L(Je),1e-4)))).toVar(),Ze=.07,Qe=e=>Y(U(.06,.3,j(e.sub(.58)).sub(_.mul(.1)))).mul(S).mul(Ze),rt=k(()=>{let e=q(d).toVar();return A(Pe.greaterThan(0).and(Ee.greaterThan(.04)),()=>{let r=V(ne.sub(_e)),i=B(.022,.05,Me).mul(U(.04,.4,Ee)).toVar(),a=i.add(S.mul(Ze)).toVar(),o=r.xz.div(R(r.y,.3)).mul(a).mul(Pe).toVar(),s=P(0).toVar();ee(8,()=>{let e=d.sub(o.mul(s));A(Y(B(G(t.map,e.mul(1.5)).level(0).a,G(n.map,e.mul(.62)).level(0).a,Me)).mul(i).add(Qe(v.add(N(Xe,e.sub(d))))).div(R(a,1e-4)).lessThanEqual(s),()=>{O()}),s.addAssign(1/8)}),e.subAssign(o.mul(s))}),e})().toVar(),it=v.add(N(Xe,rt.sub(d))).toVar(),at=Xe.mul(Qe(it.add(.02)).sub(Qe(it.sub(.02))).div(.04)).mul(Y(U(30,80,f))).toVar(),ot=rt.mul(o),st=B(G(e.map,ot).bias(p),G(e.map,rt.yx.mul(.83).add(.29)).bias(p),.45).toVar(),ct=G(t.map,rt.mul(1.5)).bias(p),lt=G(n.map,rt.mul(.62)).bias(p),ut=G(r.map,rt.mul(1.7)).bias(p),dt=B(ct.a,lt.a,Me),pt=U(.4,.6,Ee.mul(1.12).add(g.sub(.5).mul(.55)).add(dt.sub(st.a).mul(.35))).toVar(),mt=U(.4,.62,Ae.add(h.sub(.5).mul(.5)).add(ut.a.sub(st.a).mul(.3))).mul(Y(pt)).toVar(),gt=we().rgb.mul(st.rgb).mul(B(.74,1.3,h)),_t=B(gt,J(N(gt,J(.3,.55,.15))),.22),xt=m(d.div(23).add(.71)).a,St=t=>G(e.map,t.div(6.1).add(.19)).a.add(g.sub(.5).mul(.4)),Ct=m(rt.div(3.7).add(.83)).a,wt=B(_t,_t.mul(J(1.5,1.22,.7)),U(.55,.8,g).mul(.34));wt=B(wt,wt.mul(J(.62,.8,.86)),U(.5,.72,Ct).mul(.5)),wt=B(wt,ct.rgb.mul(J(.5,.46,.4)),Ve(.4,.2,st.a.add(Ct.sub(.5).mul(.4))).mul(.55)).toVar();let Tt=U(.35,.7,xt.add(St(d)).mul(.6)),Et=B(ct.rgb.mul(J(.6,.57,.52)),lt.rgb.mul(.62),Me).mul(B(.84,1.14,h)).mul(B(1,.68,Tt)).mul(nt.uBare.xyz),Dt=G(i.map,rt.mul(1.15)).bias(p).toVar(),Ot=S.mul(Y(U(1.1,2.4,v))).mul(.14).add(x.mul(Y(U(.4,1.6,be))).mul(.3)),kt=U(.5,.72,xt.mul(.7).add(g.mul(.45)).add(Ct.sub(.5).mul(.35)).add(Ot).sub(ke.mul(.7)).sub(.08).add(Dt.a.sub(.4).mul(.3))).mul(Y(mt)).toVar();wt=B(wt,Dt.rgb.mul(we().rgb.mul(1.2).add(.24)).mul(B(.8,1.1,h)),kt.mul(.85));let At=U(nt.uGrassRange.mul(.55),nt.uGrassRange.mul(2.2),f).toVar(),jt=we().rgb.mul(nt.uSward).mul(1.68).mul(B(.9,1.1,g)).mul(B(.86,1.12,h));wt=B(wt,jt,At.mul(.85)).toVar();{let e=V(he),t=Q(d.mul(.045).add(3.3)).toVar(),n=U(.15,.75,e.z.mul(.5).add(.25).add(t.sub(.5).mul(.7)).sub(ke.mul(.5))).toVar(),r=U(.5,.85,Q(d.mul(.021).add(7.9)).add(ke.mul(.4))).toVar(),i=U(.6,.7,Q(d.mul(.017).add(11.1)).mul(.7).add(t.mul(.3))).mul(n).mul(U(.02,.12,Y(e.y))).toVar(),a=wt.mul(t.mul(.24).add(.88));a=B(a,a.mul(J(.74,.88,.72)),r.mul(.6)),a=B(a,a.mul(J(1.2,1.08,.78)).add(J(.016,.01,0)),n.mul(.5)),a=B(a,J(.16,.14,.06).mul(B(.85,1.1,h)),i.mul(.65)),wt=B(wt,a,At).toVar()}let Mt=G(a.map,rt.mul(.9)).bias(p),Nt=U(.55,.78,G(e.map,d.div(7.3).add(.53)).a.add(ke.mul(.45)).add(Ae.mul(.25)).sub(kt.mul(.4))).mul(Y(mt)).toVar();wt=B(wt,Mt.rgb.mul(J(.62,.72,.5)),Nt.mul(.7));let $=B(wt,ut.rgb.mul(B(.6,.85,g)),mt);$=B($,wt.mul(1.25),pt.mul(Y(pt)).mul(1.4)),$=B($,Et,pt);let Pt=R(Ie,U(.2,.6,l.y)).toVar(),Ft=G(n.map,rt.mul(3.6).add(.53)).bias(p).toVar(),It=B(B(Et.mul(1.45),J(N(Et,J(.3,.55,.15))).mul(1.5),.3).add(J(.022,.02,.016)),Ft.rgb.mul(J(1.05,1,.94)).mul(nt.uBare.xyz),U(.55,.78,Ft.a).mul(.65));$=B($,B(It,$.mul(J(.58,.54,.5)),Pt),Se.mul(pt)),$=B($,$.mul(1.18),S.mul(pt).mul(Y(Pt)).mul(Y(Se))),St(d);let Lt=Ie.mul(.09),Rt=G(e.map,d.div(6.1).add(.19)).bias(2.5).a.add(g.sub(.5).mul(.4)).toVar(),zt=U(P(.535).sub(Lt),P(.6).sub(Lt),Rt).mul(R(Se.mul(B(.25,1,R(Ie,U(.2,.6,l.y)))),pt.mul(Ie).mul(.7))).mul(Y(Me)).toVar(),Bt=U(.44,.555,Rt).mul(Se).toVar();$=B($,$.mul(.6),Bt.mul(B(.2,.6,Pt))),$=B($,J(.055,.045,.032),zt.mul(.85));let Vt=x.mul(Y(U(.38,.62,be.add(g.sub(.5).mul(.12))))).mul(nt.uBare.w).toVar();$=B($,$.mul(J(.66,.64,.62)).add(ct.rgb.mul(.1)),Vt.mul(.85)),$=B($,$.mul(1.22),Vt.mul(Y(U(.05,.2,be))).mul(.5));let Ht=R(R(S.mul(Y(U(.8,2.2,v))),xe),D.mul(U(.5,1.8,E)).mul(.9)).toVar(),Ut=et(_e,V(he).y).mul(Y(Ht.mul(B(1,.25,U(.4,.9,$e(_e)))))).toVar(),Wt=d.mul(4.3).add(.37),Gt=B(G(n.map,Wt).bias(p).rgb,J(.5,.47,.41),.35).mul(J(1.3,1.24,1.1)).mul(B(.9,1.06,h)).mul(B(.82,1,U(0,.4,E))).toVar(),Kt=ue.mul(U(.1,.45,ke)).mul(D).mul(Y(T)).toVar();$=B($,B(ve.mul(B(1,.7,Kt)),Gt,T),D),$=B($.mul(B(1,.52,ke)),B(J(...tt).mul(B(.94,1.04,h)),J(.5,.49,.47),Ht.mul(.55)),Ut),c.colorNode=Ce($,1),c.roughnessNode=B(B(P(.96),.94,pt).mul(B(1,.4,ke.mul(pt))).mul(B(1,.82,Se.mul(pt))).mul(B(1,.7,Bt)),.09,zt);{let r=G(e.normalMap,ot).bias(p).xyz.mul(2).sub(1),a=G(t.normalMap,rt.mul(B(1.5,.31,Me))).bias(p).xyz.mul(2).sub(1),o=Y(mt.mul(.6)),s=G(i.normalMap,rt.mul(1.15)).bias(p).xyz.mul(2).sub(1),l=B(B(r.mul(J(o,o,1)),s,kt.mul(.8)),a,pt).add(J(at.mul(pt),0)),u=B(1,Me.mul(1.2).add(1.15),pt).mul(Y(zt)),m=(e,t)=>{let n=q(d.x.mul(.8).add(d.y.mul(.35)),d.y.mul(2.6).sub(d.x.mul(.5))).mul(e);return q(Q(n.add(q(t,0))).sub(Q(n.sub(q(t,0)))),Q(n.add(q(0,t))).sub(Q(n.sub(q(0,t))))).div(t*2)},h=m(.9,.08).mul(.16).add(m(.16,.05).mul(.35)).add(m(2.7,.03).mul(.05).mul(Y(U(6,18,f)))).mul(Y(U(20,90,f))).toVar(),g=.003,_=G(n.map,Wt).bias(p).a,v=J(_.sub(G(n.map,Wt.add(q(g,0))).bias(p).a).mul(4),_.sub(G(n.map,Wt.add(q(0,g))).bias(p).a).mul(4),1),y=B(J(l.xy.mul(u),l.z),B(B(ie,J(0,0,1),Kt),v,T),D),b=J(y.xy.add(De(_e.xz,Ie.mul(R(zt,Kt)))),y.z);c.normalNode=de(J(b.xy.mul(Y(Ut.mul(.85))).add(h.mul(Ut)),b.z).mul(.5).add(.5))}let qt=W(.992,I(ye(N(F(_e.mul(26)),J(12.9898,78.233,37.719))).mul(43758.5453))).mul(Y(U(4,14,f))).toVar();return c.roughnessNode=B(B(c.roughnessNode,B(B(se.mul(B(1,.6,ke)),.07,Kt),.95,T),D),B(.66,.08,qt),Ut),c.userData.mirror=Oe(fe,R(R(R(zt,Kt),ke.mul(D).mul(Y(T)).mul(.75)),ke.mul(pt).mul(.2)).mul(Y(Ut))),Ye(c,{irradiance:qe(he,u),sun:Y(Ke(u)).mul(B(1,le,D)),sky:B(.3,U(0,.5,u.x),Ne),gleam:B(R(R(B(.12,.7,ke.mul(pt)),R(zt.mul(1.15),Kt.mul(.85))),ke.mul(D).mul(Y(T)).mul(.65)),.55,Ut)}),je(c,`near`,s)}function St(e,t){let n=new w({roughness:.7,metalness:0,color:new b(1,1,1)}),r=ze(),i=Be(),a=_e,o=a.xz,s=L(ge),c=U(70,260,s).mul(5),l=V(he).y,u=G(e.map,o.div(41).add(.37)).a,d=G(e.map,o.div(9.7).add(.11)).a,f=q(a.x.mul(.8).sub(a.z.mul(.6)),a.x.mul(.6).add(a.z.mul(.8))),p=Q(f.mul(.85)).mul(.6).add(Q(f.yx.mul(2.3).add(5.3)).mul(.4)),m=u.mul(.65).add(d.mul(.35)),h=U(0,.12,B(-1.15,.75,Qe.uSnow).add(l.sub(.8).mul(2.4)).add(m.sub(.5).mul(1.5)).add(p.sub(.5).mul(.35))).mul(W(.001,Qe.uSnow)).toVar(),g=a.y.add(u.mul(34)).add(o.x.mul(.06)).div(7).toVar(),_=B(Z(q(F(g),3)),.5,U(.25,.8,ce(g))),v=B(G(t.map,o.mul(.62)).bias(c).rgb,G(t.map,o.mul(.13).add(.31)).bias(c).rgb,.5),y=we().rgb.mul(J(.62,.6,.58)).mul(_.mul(.5).add(.62)).mul(N(v,J(.3,.5,.2)).mul(.9).add(.45)).mul(d.mul(.3).add(.85)).toVar(),x=M(r.x,0,1).toVar(),S=q(r.y,r.z),C=q(S.y.negate(),S.x),T=Z(q(F(N(o,C).div(4.8)),7)).toVar(),E=N(o,C).div(.06),D=Y(U(.08,.22,ce(E))).toVar(),O=ye(I(E).mul(Math.PI*2)).mul(D).toVar();n.colorNode=Ce(B(y,J(...tt).mul(B(.94,1.04,u)).mul(B(1,T.mul(.05).add(.975).add(O.mul(.015)),x)),h),1);{let e=e=>Nt(q(o.x.mul(.8).add(o.y.mul(.35)),o.y.mul(2.6).sub(o.x.mul(.5))).mul(e));n.normalNode=de(J(B(k(()=>{let t=q(0,0).toVar();return A(s.lessThan(90),()=>{t.assign(e(.9).mul(.16).add(e(.16).mul(.35)).add(e(2.7).mul(.05).mul(Y(U(6,18,s)))).mul(Y(U(20,90,s))))}),t})().toVar(),C.mul(re(I(E).mul(Math.PI*2)).mul(.12).mul(D)),x).mul(h).add(q(d.sub(.5).mul(.15)).mul(Y(h))),1).mul(.5).add(.5))}let ee=W(B(.992,.997,x),I(ye(N(F(a.mul(26)),J(12.9898,78.233,37.719))).mul(43758.5453))).mul(Y(U(4,14,s))).toVar();return n.roughnessNode=B(P(.95),B(B(.66,.58,x),.08,ee),h),Ye(n,{irradiance:qe(he,i),sun:Y(Ke(i)),sky:B(.3,U(0,.5,i.x),Ne),gleam:B(.12,.55,h)}),n}function Ct(){let e=new w({roughness:.95,metalness:0,vertexColors:!0,color:new b(1,1,1)}),t=V(D);return Ye(e,{irradiance:Pe.mul(P(.8).add(t.y.mul(.2))).mul(1.9)}),e}var wt={uGlow:K(1)};function Tt(){let e=new w({roughness:.25,metalness:0,vertexColors:!0,color:new b(1,1,1)});return e.colorNode=we().mul(.12),e.emissiveNode=we().mul(wt.uGlow),e}var Et={uLit:K(1)};function Dt(){let e=new w({roughness:.2,metalness:0,vertexColors:!0,color:new b(1,1,1)}),t=we();e.colorNode=t.mul(.05);let n=ye(xe.mul(5.3).add(t.x.mul(91))).mul(ye(xe.mul(2.3).add(t.y.mul(57)))).mul(.07).add(1);return e.emissiveNode=t.mul(Et.uLit).mul(n),e}function Ot(e=!1){let t=new w({roughness:.05,metalness:0,color:new b(.55,.62,.64),vertexColors:e,transparent:!0,opacity:e?.32:.16,depthWrite:!1});if(e){let e=we();t.colorNode=e.mul(.05).add(.25),t.emissiveNode=e.mul(Et.uLit).mul(.6)}return t}function kt(e){let t=new w({color:e.color,roughness:e.roughness,metalness:e.metalness,emissive:e.emissive??new b(0,0,0),emissiveIntensity:e.emissiveIntensity??1});return Ye(t,{irradiance:J(.05,.045,.04),sky:P(0)}),t}var At={uRockBroad:K(.8),uRockFacet:K(0),uRockWorn:K(0),uShaftTop:K(new s),uShaftUp:K(new c(0,1,0)),uShaftSun:K(new c)};function jt(e,t,n={}){let r=new w({roughness:1,metalness:0,color:new b(1,1,1)}),i=ze(),a=Be(),o=_e,s=V(he),c=n.scale??.3,l=n.normalScale??1.4,u=n.dip??[.05,.03],d=At.uRockFacet,f=At.uRockWorn,p=At.uRockBroad,m=At.uShaftTop,h=At.uShaftUp,g=At.uShaftSun,_=ve(j(s),J(5)),v=_.div(_.x.add(_.y).add(_.z)).toVar(),y=o.zy.mul(c),x=o.xz.mul(c),S=o.xy.mul(c),C=U(110,320,L(ge)).mul(6),T=(e,t,n=C)=>G(e,t).bias(n),E=T(e.map,y).mul(v.x).add(T(e.map,x).mul(v.y)).add(T(e.map,S).mul(v.z)).toVar(),D=T(e.map,q(o.x.add(o.z.mul(.71)),o.y.mul(.9).add(o.z.mul(.37))).mul(c*.11),C.mul(.6)).toVar(),O=V(ae(o).cross(oe(o))),k=H(N(O,s).lessThan(0),O.negate(),O),A=Y(U(45,120,L(ge))),ee=d.mul(A),te=Y(N(k,s)).mul(ee),ne=Y(U(.4,.75,j(s.y))),M=E.rgb.mul(B(J(.8,.79,.8),J(1.2,1.17,1.1),U(.25,.75,D.a))),re=G(e.map,q(o.x.add(o.z.mul(.71)),o.y.mul(.9).add(o.z.mul(.37))).mul(c*.11)).bias(R(C,4.5)).toVar(),ie=o.y.add(N(o.xz,q(u[0],u[1]))).add(re.r.sub(.5).mul(1.5)).toVar(),se=i.w.mul(ne).mul(B(1,U(.3,.6,D.a),f.mul(.75))).toVar(),le=o.x.add(o.z.mul(.6)),ue=(e,t)=>{let n=ie.div(e).add(t*3.7).toVar(),r=n.add(ye(n.mul(1.9).add(re.g.mul(5))).mul(.3)).add(ye(n.mul(.83).add(1.3)).mul(.26)).toVar(),i=Y(U(.2,.55,ce(r))).toVar(),a=I(r).toVar(),o=B(.72,1.14,I(ye(F(r).mul(91.7)).mul(43758.5))),s=F(r.add(.5)).toVar(),c=I(ye(s.mul(57.3)).mul(24634.6)).toVar(),l=U(.4,.8,c).mul(U(.42,.6,Q(q(le.mul(.09/e),s.mul(7.13))))).toVar(),u=I(c.mul(7.31)).toVar(),d=z(a,Y(a)).div(B(.1,.3,u).mul(Math.sqrt(.3/e))).toVar();return{large:i,tone:o,line:B(1,U(0,1,d),l).toVar(),dark:B(.62,B(.86,.5,u),f),lip:d.mul(Y(d)).mul(4).mul(W(d,1)).mul(H(a.lessThan(.5),1,-1)).mul(l)}},de=ue(.3,0),fe=ue(1.4,1),pe=ue(6.5,2),me=se.mul(de.large).toVar(),xe=se.mul(fe.large).toVar(),K=se.mul(pe.large).toVar(),Se=B(1,fe.line,Y(de.large.mul(.8))).toVar(),Te=B(1,pe.line,Y(fe.large.mul(.8))).toVar();M=M.mul(B(1,de.tone.mul(B(de.dark,1,de.line)),me)).mul(B(1,B(1,fe.tone,.6).mul(B(fe.dark,1,Se)),xe)).mul(B(1,B(1,pe.tone,.45).mul(B(pe.dark,1,Te)),K));let Ee=de.lip.mul(me).add(fe.lip.mul(xe).mul(Y(de.large.mul(.8)))).add(pe.lip.mul(K).mul(Y(fe.large.mul(.8))).mul(1.3)).mul(B(.35,1,f)).toVar(),De=B(.45,1,U(.08,.5,E.a)).mul(B(1,B(B(.65,.5,f),1,de.line),me)).mul(B(1,B(.6,1,Se),xe)).mul(B(1,B(.6,1,Te),K)).toVar(),Oe=G(e.map,q(o.z.mul(.37),o.y.mul(.03))).a.mul(v.x).add(G(e.map,q(o.x.mul(.37),o.y.mul(.03).add(.5))).a.mul(v.z)),ke=B(G(e.map,q(o.z.mul(.043),o.y.mul(.007).add(.31))).a.mul(v.x).add(G(e.map,q(o.x.mul(.043),o.y.mul(.007).add(.77))).a.mul(v.z)),Oe,Y(U(30,100,L(ge)))).toVar(),Ae=U(.5,.72,ke).mul(ne).mul(i.w.mul(.65).add(.35)).toVar(),Me=U(.62,.8,D.r.add(D.a).mul(.5).add(ke.sub(.5).mul(.5))).mul(ne).mul(f).toVar();M=M.mul(B(J(1),B(J(.56,.53,.5),J(.7,.7,.72),f),Ae.mul(B(.75,.6,f)))),M=M.mul(B(J(1),J(1.1,.83,.6),Me.mul(.45))),M=M.mul(B(1,1.2,U(.5,.28,ke).mul(ne).mul(f)));let Pe=Y(U(25,80,L(ge))).mul(ne).mul(f).toVar(),Fe=(t,n)=>G(e.map,q(t.mul(.55),o.y.mul(.045).add(n))).a,Ie=Fe(o.z.add(.05),0).sub(Fe(o.z.sub(.05),0)).mul(v.x).toVar(),Re=Fe(o.x.add(.05),.5).sub(Fe(o.x.sub(.05),.5)).mul(v.z).toVar(),Ve=Fe(o.z,0).mul(v.x).add(Fe(o.x,.5).mul(v.z));M=M.mul(B(1,B(.86,1.06,U(.3,.7,Ve)),Pe.mul(v.x.add(v.z))));let He=R(R(i.y,Ae.mul(.25)),Le(a).mul(.9)).toVar(),Ue=H(v.x.greaterThan(v.z),y,S).mul(5.5),Ge=B(G(t.map,Ue),G(t.map,x.mul(5.5)),v.y),Je=B(.4,U(.03,.3,a.x).mul(Y(U(.2,.8,a.y).mul(.92))),Ne),Xe=U(0,.22,i.x.mul(Je).mul(1.5).add(Y(E.a).mul(.4)).add(Ge.a.mul(.45)).sub(1)).toVar();M=M.mul(te.mul(.7).add(1));let Ze=R(et(o,s.y.add(Y(E.a).mul(.12))).mul(Y(R(i.z,0))),U(-.3,-.8,i.z).mul(W(.5,$e(o)))).toVar();r.colorNode=Ce(B(B(we().rgb.mul(M).mul(B(1,.5,He)),Ge.rgb,Xe),J(...tt).mul(B(.9,1.02,E.a)),Ze),1),r.roughnessNode=B(B(U(.55,.9,E.a).mul(-.14).add(.93).clamp(.5,1).mul(B(1,.45,He.mul(Y(Xe)))),.97,Xe),.66,Ze);let Qe=Y(Xe.mul(.6)).mul(l),nt=Y(U(3,13,L(ge))).mul(.8).toVar(),rt=U(30,130,L(ge)).mul(1.5).toVar(),it=(t,n)=>{let r=T(e.normalMap,t).xyz.mul(2).sub(1),i=G(e.normalMap,t.mul(.23).add(.37)).xy.mul(2).sub(1).mul(n),a=G(e.normalMap,t.mul(3.7).add(.19)).xy.mul(2).sub(1).mul(nt),o=G(e.normalMap,t.mul(.052).add(.71)).xy.mul(2).sub(1).mul(rt);return J(r.xy.add(i).add(a).add(o),r.z)},at=it(y,p),ot=it(x,p.mul(.5)),st=it(S,p),ct=J(at.xy.mul(Qe).add(s.zy),j(at.z).mul(s.x)),lt=J(ot.xy.mul(Qe).add(s.xz),j(ot.z).mul(s.y)),ut=J(st.xy.mul(Qe).add(s.xy),j(st.z).mul(s.z)),dt=V(ct.zyx.mul(v.x).add(lt.xzy.mul(v.y)).add(ut.xyz.mul(v.z))),ft=J(0,1,0).sub(s.mul(s.y)).mul(Ee.mul(1.1)).add(J(Re,0,Ie).mul(Pe).mul(1.6)),pt=V(B(V(B(dt,k,ee.mul(.2)).sub(ft)),s,Ze.mul(.75))).toVar(),mt=P(1);if(n.relief){let e=R(L(ae(o.xz)),L(oe(o.xz))).toVar(),t=Ft(o,s,pt,e,ne.mul(Y(Ze.mul(.6))),8,.42);pt=t.normal,mt=t.cavity,r.colorNode=Ce(r.colorNode.xyz.mul(B(1,mt,Y(Ze))),1)}let ht=We(.03);r.normalNode=ht.bend(be(pt)),r.colorNode=Ce(r.colorNode.xyz.mul(ht.wear.mul(.1).add(1)),1);let X=U(.62,.95,a.y).mul(W(a.x,.004)).mul(W(.001,m.w)),gt=o.sub(m.xyz),_t=L(gt.sub(h.mul(N(gt,h)))),vt=g.mul(R(N(pt,h),0)).mul(X).mul(Y(U(m.w.sub(.3),m.w.add(.05),_t)));return Ye(r,{irradiance:qe(V(B(s,pt,.85)),a).add(vt).mul(De).mul(B(1,mt,.8)),sun:Y(Ke(a)),sky:B(.3,U(0,.5,a.x),Ne).mul(De),gleam:B(B(.3,1,He),.55,Ze)}),n.relief||n.by===`eye`?je(r,`near`,n.by):r}var Mt={uFarWood:K(new c(.07,.15,.06)),uFarGrass:K(new c(.16,.2,.08)),uFarSnow:K(0),uFarRing:K(new c(0,0,0))},Z=k(([e])=>{let t=I(J(e.xyx).mul(.1031)).toVar();return t.addAssign(N(t,t.yzx.add(33.33))),I(t.x.add(t.y).mul(t.z))}),Q=k(([e])=>{let t=F(e).toVar(),n=I(e),r=n.mul(n).mul(n.mul(-2).add(3)).toVar();return B(B(Z(t),Z(t.add(q(1,0))),r.x),B(Z(t.add(q(0,1))),Z(t.add(q(1,1))),r.x),r.y)}),Nt=k(([e])=>{let t=F(e).toVar(),n=I(e).toVar(),r=n.mul(n).mul(n.mul(-2).add(3)).toVar(),i=n.mul(Y(n)).mul(6),a=Z(t).toVar(),o=Z(t.add(q(1,0))).toVar(),s=Z(t.add(q(0,1))).toVar(),c=Z(t.add(q(1,1))),l=a.sub(o).sub(s).add(c).toVar();return q(i.x.mul(o.sub(a).add(l.mul(r.y))),i.y.mul(s.sub(a).add(l.mul(r.x))))});function $(e,t,n){let r=Se().toVar(),i=r.div(t).toVar(),a=ae(i),o=oe(i),s=Q(r.div(1.6).add(q(3.7,1.1))).mul(2.4).add(Q(r.div(.55).add(q(8.2,5.9))).mul(.55)).add(r.x.mul(.1)).add(r.y.mul(.06)).toVar(),c=F(s).toVar(),l=I(s).toVar(),u=e=>q(Z(q(e,1.3)),F(Z(q(e.add(.5),7.9)).mul(n)).div(n)),d=i.add(u(c)).toVar(),f=i.add(u(c.add(1))).toVar(),p=(e,t)=>G(e,t).grad(a,o),m=p(e.map,d).toVar(),h=p(e.map,f).toVar(),g=m.a.add(Y(l)),_=h.a.add(l),v=R(g,_).sub(.05),y=R(g.sub(v),0),b=R(_.sub(v),0),x=b.div(y.add(b).add(1e-5)).toVar();return{map:B(m,h,x),normal:B(p(e.normalMap,d).xyz,p(e.normalMap,f).xyz,x),orm:B(p(e.ormMap,d),p(e.ormMap,f),x)}}var Pt=k(([e])=>{let t=q(e).toVar(),n=P(0).toVar(),r=P(.5).toVar();return ee(4,()=>{n.addAssign(r.mul(Q(t))),t.assign(t.mul(2.03).add(17.1)),r.mulAssign(.5)}),n}),Ft=(e,t,n,r,i,a=3.4,o=.55)=>{let s=t.x.mul(t.x).toVar(),c=t.z.mul(t.z).toVar(),l=R(c.add(s),1e-4).toVar(),u=Y(U(2.2,4.5,r)).toVar(),d=Y(U(.9,1.8,r)).toVar(),f=Y(U(.35,.7,r)).toVar(),p=e=>{let t=Y(j(Q(e).mul(2).sub(1)));return t.mul(t)},m=(e,t)=>{let n=Q(q(e.div(37),t.div(61)).add(5.3)),r=p(q(e.div(19).add(n.mul(1.6)),t.div(48)).add(1.7)).mul(u),i=p(q(e.div(7.3).add(n.mul(2.4)),t.div(17)).add(8.2)).mul(.5).mul(d),a=t.add(e.mul(.09)).add(Q(q(e.div(70),t.div(90)).add(2.1)).mul(16)).toVar(),o=F(a.div(11)),s=I(a.div(11)).toVar(),c=Q(q(o.mul(.73),7.7)),l=U(.55,.9,s).mul(Y(U(.9,1,s))).mul(.45).mul(d).mul(U(.42,.72,Q(q(e.div(17),o.mul(1.31)).add(4.4)))).mul(W(.35,c)),m=Q(q(e.div(2.6),t.div(3.1)).add(3.3)).mul(.25).mul(f);return r.add(i).add(l).add(m)},h=m(e.x,e.y).toVar(),g=m(e.z,e.y).toVar(),_=m(e.x.add(1.2),e.y).sub(h).div(1.2),v=m(e.z.add(1.2),e.y).sub(g).div(1.2),y=m(e.x,e.y.add(1.2)).sub(h).div(1.2),b=m(e.z,e.y.add(1.2)).sub(g).div(1.2),x=h.mul(c).add(g.mul(s)).div(l).toVar(),S=y.mul(c).add(b.mul(s)).div(l),C=V(J(0,1,0).sub(t.mul(t.y)).add(J(0,1e-4,0))).toVar(),w=J(_.mul(c),0,v.mul(s)).div(l);return{normal:V(n.sub(w.add(C.mul(S.mul(C.y))).mul(a).mul(i))).toVar(),cavity:B(1,B(o,1.18,U(.05,1.1,x)),i.mul(.9)).toVar()}},It=k(([e])=>{let t=F(e).toVar(),n=I(e).toVar(),r=P(9).toVar(),i=P(0).toVar(),a=q(0).toVar();for(let e=-1;e<=1;e++)for(let o=-1;o<=1;o++){let s=q(o,e),c=Z(t.add(s)).toVar(),l=s.add(.1).add(q(c,I(c.mul(57.31))).mul(.8)).sub(n).toVar(),u=N(l,l).div(I(c.mul(13.7)).mul(.22).add(.3)).toVar();A(u.lessThan(r),()=>{r.assign(u),a.assign(l),i.assign(c)})}let o=R(0,Y(r)).toVar();return Ce(o,a.mul(W(.001,o)).mul(2.4),i)});function Lt(e={}){let t=new w({roughness:1,metalness:0,color:new b(1,1,1)}),n=ze(),r=P(+!!e.cover),i=Mt.uFarWood,a=Mt.uFarGrass,o=_e,s=o.xz,c=V(he),l=n.w,u=n.z,d=R(L(ae(s)),L(oe(s))).toVar(),f=Pt(s.mul(.03)).toVar(),p=Q(s.mul(.21)).toVar(),m=c.xz.div(R(L(c.xz),.04)).toVar(),h=P(0);for(let e=-2;e<=2;e++)h=h.add(Q(s.add(m.mul(e*10)).mul(.075))).add(Q(s.add(m.mul(e*4)).mul(.19).add(9)).mul(.5));h=h.div(7.5).sub(.5).toVar();let g=U(.015,.16,Y(c.y)).mul(Y(U(3,9,d))).toVar(),_=Y(U(.52,.74,c.y)).toVar(),v=f.sub(.5).add(p.sub(.5).mul(.2)).add(h.mul(.9).mul(g)).toVar(),y=o.y.add(f.mul(34)).add(s.x.mul(.06)).div(7).toVar(),x=B(Z(q(F(y),3)),.5,U(.25,.8,ce(y))),S=we().rgb.mul(x.mul(.5).add(.62).add(f.sub(.5).mul(.3))).mul(Y(_.mul(.28))).mul(Y(R(u,0).mul(.28))),C=h.mul(1.5).mul(g).add(1);S=B(S,J(.33,.32,.31).mul(p.mul(.3).add(.85)),U(.3,.5,l.add(v.mul(.2))).mul(Y(_)).mul(Ve(.93,.83,c.y)).mul(.65));let T=M(R(u,0).mul(1.4).sub(h.mul(1.6).mul(g)),0,1).toVar(),E=Q(s.mul(.045).add(3.3)).toVar(),D=U(.15,.75,c.z.mul(.5).add(.25).add(T.negate().mul(.5)).add(E.sub(.5).mul(.7)).add(R(u.negate(),0).mul(.6))).toVar(),O=a.mul(f.mul(.45).add(.8)).mul(E.mul(.24).add(.88));O=B(O,O.mul(J(.74,.88,.72)),T.mul(.7)),O=B(O,O.mul(J(1.22,1.1,.78)).add(J(.018,.012,0)),D.mul(.55));let k=U(.6,.7,Q(s.mul(.017).add(11.1)).mul(.7).add(E.mul(.3))).mul(D).mul(g.mul(.6).add(.4)).toVar();O=B(O,J(.16,.14,.06).mul(p.mul(.3).add(.85)),k.mul(.7));let A=P(e.cover?.46:.62),ee=U(A,A.add(.1),Q(s.mul(.013).add(23.7)).mul(.7).add(p.mul(.3))).mul(U(.32,.5,l)).toVar();O=B(O,J(.115,.075,.08).mul(p.mul(.3).add(.85)),ee.mul(.6));let j=U(0,.07,P(.62).sub(l).add(v.mul(.3))).mul(Y(_)).mul(.9).toVar();S=B(S,O,j);let te=(e.cover?n.y.sub(.5).mul(.6).add(v.mul(.25)):P(.37).sub(l).add(u.mul(.13)).add(v.mul(.42))).toVar(),ne=Mt.uFarRing,re=H(ne.z.greaterThan(0),U(ne.z,ne.z.add(180),L(s.sub(ne.xy))),P(1)).toVar(),ie=U(0,.05,te).mul(Y(_.mul(.85))).mul(re.mul(re)).toVar(),N=U(-.14,.02,te).mul(Y(_.mul(.85))).mul(re.mul(.8).add(.2)).toVar(),se=U(.42,.58,Q(s.mul(.011).add(5)).add(l.sub(.2).mul(.5))).toVar(),le=B(3.7,2.6,se),ue=It(s.div(le)).toVar(),z=Y(U(.25,.7,d.div(le))).mul(U(.55,.8,c.y)).toVar(),de=i.mul(B(J(1),J(.62,.74,.82),se)).mul(p.mul(.2).add(.9));S=B(S,de.mul(.45),ie.mul(.9));let fe=W(I(ue.w.mul(91.3)),R(ie.mul(1.05),N.mul(.22))).mul(U(0,.3,ue.x)).toVar(),pe=ue.x.mul(.36).add(.74).mul(ue.w.mul(.4).add(.8)),me=R(W(1e-4,ie),W(1e-4,N).mul(z)).toVar();S=B(S,de.mul(B(.84,pe,z)).mul(B(.6,1,U(.3,.7,c.y))),B(R(ie,Y(U(.3,.6,c.y)).mul(W(l,.5)).mul(.9)),fe,z).mul(me));let ge=V(c.sub(J(ue.y,0,ue.z).mul(.3).mul(z).mul(fe).mul(me))).toVar(),ve=Ve(.86,.6,c.y).mul(Y(ie)).mul(U(.3,.55,l)).toVar(),ye=e.light?{normal:ge,cavity:P(1)}:Ft(o,c,ge,d,ve),G=ye.normal,xe=ye.cavity;S=S.mul(xe);let K=R(u,0).mul(.5).add(R(h.negate(),0).mul(3).mul(g).mul(U(.32,.62,f.add(p.sub(.5).mul(.3))))).add(W(.7,x).mul(U(.42,.56,p.add(f.sub(.5).mul(.8)))).mul(.42).mul(_)).toVar(),Se=Mt.uFarSnow.mul(U(.5,.78,G.y)).mul(Y(ie.mul(.85))).mul(U(.25,.55,f.add(p.sub(.5).mul(.4)).add(R(u,0).mul(.5)).add(.15))),Te=R(U(0,.08,l.sub(.6).add(u.mul(.12)).add(v.mul(.35))).mul(U(K.mul(-.4).add(.5),K.mul(-.4).add(.72),G.y)),Se).toVar();S=B(S,J(1.3,1.34,1.42),Te);let Ee=U(.5,.9,n.x).toVar();t.colorNode=Ce(B(S.mul(B(C,1,Te.mul(.7))),Pe.mul(J(.16,.24,.3)).add(J(.012,.02,.028)),Ee),1),t.roughnessNode=B(P(1),.16,Ee),t.normalNode=be(V(B(G,J(0,1,0),Ee))),Ye(t,{irradiance:B(Pe.mul(P(.55).add(G.y.mul(.45))),Ge(G),Ne).mul(B(1,xe,.8)),sun:B(Y(n.y),P(1),r),gleam:B(B(.08,.5,Te),1.6,Ee)}),je(t,`far`,e.by);let De=M(L(s.sub(ne.xy)).sub(ne.z).div(30),0,1),Oe=Q(s.div(2.4)).mul(.65).add(Q(s.div(.85).add(7.3)).mul(.35));return t.opacityNode=t.opacityNode.mul(H(ne.z.greaterThan(0).and(Oe.greaterThan(De.mul(.7).add(.15))),P(0),P(1))),t}var Rt=`
uniform float uSeed;
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(.1031, .1030, .0973) + uSeed * .0137);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
float hash21(vec2 p) { return hash22(p).x; }
// Gradient noise, periodic over 'per' lattice cells. Roughly -0.7..0.7.
float gnoise(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  vec2 u = f * f * f * (f * (f * 6. - 15.) + 10.);
  vec2 ga = hash22(mod(i, per)) * 2. - 1.;
  vec2 gb = hash22(mod(i + vec2(1, 0), per)) * 2. - 1.;
  vec2 gc = hash22(mod(i + vec2(0, 1), per)) * 2. - 1.;
  vec2 gd = hash22(mod(i + vec2(1, 1), per)) * 2. - 1.;
  float a = dot(ga, f), b = dot(gb, f - vec2(1, 0)), c = dot(gc, f - vec2(0, 1)), d = dot(gd, f - vec2(1, 1));
  return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}
float fbm(vec2 uv, vec2 freq, int octaves, float gain) {
  float sum = 0., amp = .5;
  for (int i = 0; i < 8; i++) {
    if (i >= octaves) break;
    sum += amp * gnoise(uv * freq + float(i) * 3.7, freq);
    freq *= 2.; amp *= gain;
  }
  return sum;
}
// Cellular noise: distance to nearest and second-nearest feature point.
vec2 worley(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float d1 = 9., d2 = 9.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 o = hash22(mod(i + g, per));
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; } else if (d < d2) { d2 = d; }
  }
  return vec2(d1, d2);
}
// The same, with a number belonging to the nearest cell: for giving each piece its own height or shade.
vec3 worleyId(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float d1 = 9., d2 = 9., id = 0.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 c = mod(i + g, per);
    vec2 o = hash22(c);
    float d = length(g + o - f);
    if (d < d1) { d2 = d1; d1 = d; id = hash21(c + 17.3); } else if (d < d2) { d2 = d; }
  }
  return vec3(d1, d2, id);
}
// Flat faces meeting in creases, as rock breaks: each cell holds a tilted plane, and the height
// is the highest of the planes nearby. About -0.3 to 0.8.
float facets(vec2 x, vec2 per) {
  vec2 i = floor(x), f = fract(x);
  float best = -9.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 c = mod(i + g, per);
    vec2 d = f - g - hash22(c);
    vec2 n = hash22(c + 31.7) * 2. - 1.;
    best = max(best, hash21(c + 5.1) * .5 - dot(d, n) * .9 - dot(d, d) * .35);
  }
  return best;
}
`;function zt(e){let t=e=>e.toFixed(3),n=e=>`vec2(${t(e[0])}, ${t(e[1])})`,r=e=>`vec3(${t(e[0])}, ${t(e[1])}, ${t(e[2])})`;return{normalStrength:e.normal,height:`
float heightFn(vec2 uv) {
  float warp = fbm(uv, vec2(3., 2.), 3, .5);
  float sway = fbm(uv + 4.1, vec2(4., 2.), 3, .5);
  vec3 pl = worleyId(uv * ${n(e.plate)} + vec2(warp * 1.5, sway * .6), ${n(e.plate)});
  float furrow = mix(${t(1-e.deep)}, 1., smoothstep(.0, ${t(e.furrow)} * (1. + fbm(uv + 7.3, vec2(6., 3.), 2, .5)), pl.y - pl.x));
  float plate = .42 + ${t(e.rise)} * (pl.z - .2);
  vec3 fl = worleyId(uv * ${n(e.flake)} + vec2(warp * 2.5 + 3., sway), ${n(e.flake)});
  float flake = ((fl.z - .5) + (.45 - fl.x) * .45 - (1. - smoothstep(.0, .1, fl.y - fl.x)) * .35) * ${t(e.flakes)};
  vec3 sc = worleyId(uv * ${n(e.scale)} + vec2(1.7, warp), ${n(e.scale)});
  float scale = ((sc.z - .5) * smoothstep(.0, .1, sc.y - sc.x) - (1. - smoothstep(.0, .07, sc.y - sc.x)) * .3) * ${t(e.scales)};
  float fibre = gnoise(vec2(uv.x * 64., uv.y * 6.), vec2(64., 6.)) * .5 + gnoise(vec2(uv.x * 150., uv.y * 14.), vec2(150., 14.)) * .3;
  float body = plate + flake + scale + fibre * ${t(e.fibre)} + fbm(uv + 3., vec2(5.), 3, .5) * .12;
  return clamp(.04 + furrow * body, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(4., 3.), 4, .5);
  vec3 base = mix(${r(e.dark)}, ${r(e.light)}, smoothstep(.12, .85, h + t * .3));
  // Where a flake has come away the bark under it is fresher.
  base = mix(base, ${r(e.fresh)}, smoothstep(.5, .3, h) * smoothstep(.12, .28, h) * .55);
  float warm = fbm(uv + 2.1, vec2(2., 2.), 3, .5);
  base *= mix(vec3(1.08, .96, .84), vec3(.9, .98, 1.08), smoothstep(.3, .7, warm));
  // Grey-green crust on the high parts, round pale lichens in colonies, and now and then a small yellow-orange one.
  float lichen = ${t(e.lichen)};
  base = mix(base, vec3(.4, .45, .34), smoothstep(.1, .4, fbm(uv + 8., vec2(5., 4.), 3, .5)) * smoothstep(.5, .8, h) * .5 * min(lichen, 1.));
  vec2 w = worley(uv * vec2(9., 7.) + 4., vec2(9., 7.));
  float colony = smoothstep(.45, .72, fbm(uv + 11., vec2(3., 3.), 3, .5));
  float disc = (1. - smoothstep(.1, .3, w.x)) * colony * smoothstep(.4, .75, h) * min(lichen, 1.5);
  base = mix(base, vec3(.62, .66, .5), min(disc * .6, 1.));
  vec2 w2 = worley(uv * vec2(17., 13.) + 9., vec2(17., 13.));
  float fleck = (1. - smoothstep(.05, .16, w2.x)) * smoothstep(.62, .8, fbm(uv + 21., vec2(4., 4.), 3, .5)) * smoothstep(.5, .8, h) * min(lichen, 1.);
  base = mix(base, vec3(.62, .45, .14), fleck * .7);
  albedo = base * (1. - cavity * ${t(.3+.4*e.deep)});
  rough = clamp(.9 + cavity * .08 - disc * .1, .6, 1.);
}`}}function Bt(e){let t=e=>`vec3(${e.map(e=>e.toFixed(3)).join(`, `)})`;return{normalStrength:5.5,height:`
vec4 brickCell(vec2 uv) {
  // (Fifteen units across, where a header is one and a stretcher two; twenty courses up.)
  // (Rows and periods are counted round, so that the picture meets itself at its edges.)
  float row = mod(floor(uv.y * 20.), 20.), fy = fract(uv.y * 20.);
  float x = uv.x * 15. + mod(row * 3., 5.);
  float period = mod(floor(x / 5.), 3.), p = mod(x, 5.);
  float start = p < 2. ? 0. : p < 4. ? 2. : 4., len = p < 4. ? 2. : 1.;
  float fx = (p - start) / len;
  float id = hash21(vec2(period * 5. + start, row) + 7.);
  return vec4(fx, fy, id, len);
}
float heightFn(vec2 uv) {
  vec4 c = brickCell(uv);
  // Joints: the bed joint about a centimetre and a half, the cross joints a little narrower.
  float jx = .045 / c.w, jy = .075;
  float ex = min(c.x, 1. - c.x) / jx, ey = min(c.y, 1. - c.y) / jy;
  float face = smoothstep(.55, 1.35, min(ex, ey * 1.0));
  float dent = fbm(uv + c.z * 3.1, vec2(60.), 3, .55) * .12 + (c.z - .5) * .06;
  float pit = smoothstep(.62, .78, fbm(uv + 2.3, vec2(110.), 2, .5)) * .1;
  float mortar = .22 + fbm(uv + 9.1, vec2(140.), 2, .5) * .08;
  return clamp(mix(mortar, .74 + dent - pit, face), 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec4 c = brickCell(uv);
  float id = c.z, k = fract(id * 13.7), m = fract(id * 7.31);
  vec3 clay = mix(${t(e.low)}, ${t(e.high)}, k);
  // Fired hardest nearest the fire, and darkest. A few came out of the kiln pale.
  clay = mix(clay, ${t(e.hard)}, step(.86, m) * .85);
  clay = mix(clay, ${t(e.soft)}, step(m, .07) * .7);
  // Within a brick the colour wanders, darker in fire-flashes along one end.
  clay *= .86 + .22 * fbm(uv + id * 5., vec2(30.), 3, .5) + .14;
  clay *= mix(1., .78, smoothstep(.55, 1., abs(c.x - .5) * 2.) * step(.5, fract(id * 3.3)) * .6);
  vec3 lime = vec3(.44, .42, .38) * (.85 + .2 * fbm(uv + 1.7, vec2(70.), 2, .5));
  float face = smoothstep(.36, .5, h);
  // Weather has washed some of the lime over the brick, and dirt down it.
  float bloom = smoothstep(.25, .65, fbm(uv + 6.6, vec2(4., 7.), 4, .55)) * .22;
  albedo = mix(lime, clay, face);
  albedo = mix(albedo, lime * .9, bloom * face * .5);
  albedo *= (1. - cavity * .45) * (.95 + .1 * hash21(floor(uv * 512.)));
  rough = mix(.94, .82, face);
}`}}var Vt={ashlar:{normalStrength:4.5,height:`
vec4 ashlarCell(vec2 uv) {
  float row = mod(floor(uv.y * 6.), 6.), fy = fract(uv.y * 6.);
  float n = 3. + step(.5, hash21(vec2(row, 3.)));
  float x = fract(uv.x + hash21(vec2(row, 7.))) * n, b = floor(x);
  // (The joint before block b stands a little off its even place, and so does the one after.)
  float j0 = (hash21(vec2(row * 11. + mod(b, n), 5.)) - .5) * .5, j1 = (hash21(vec2(row * 11. + mod(b + 1., n), 5.)) - .5) * .5;
  float s = b + j0, e = b + 1. + j1;
  if (x < s) { e = s; b -= 1.; s = b + (hash21(vec2(row * 11. + mod(b, n), 5.)) - .5) * .5; }
  else if (x > e) { s = e; b += 1.; e = b + 1. + (hash21(vec2(row * 11. + mod(b + 1., n), 5.)) - .5) * .5; }
  float len = (e - s) / n * 2.4;
  return vec4((x - s) / (e - s), fy, hash21(vec2(mod(b, n) + row * 13., 9.)), len);
}
// How far a point is in from the nearest joint, in metres.
float ashlarEdge(vec2 uv, vec4 c) { return min(min(c.x, 1. - c.x) * c.w, min(c.y, 1. - c.y) * .4); }
float heightFn(vec2 uv) {
  vec4 c = ashlarCell(uv);
  float d = ashlarEdge(uv, c) + fbm(uv + c.z * 4.1, vec2(96.), 2, .5) * .006;
  // The arris worn round over a couple of centimetres, and here and there a chip out of it.
  float face = smoothstep(.004, .026, d);
  float chip = smoothstep(.6, .8, fbm(uv + 3.3, vec2(48.), 3, .5)) * (1. - smoothstep(.02, .07, d));
  float tool = gnoise(vec2(uv.x * 20., uv.y * 140.) + c.z * 30., vec2(20., 140.)) * .5;
  float dent = fbm(uv + c.z * 2.7, vec2(24.), 3, .55) * .14 + (c.z - .5) * .05;
  float mortar = .2 + fbm(uv + 9.1, vec2(160.), 2, .5) * .06;
  return clamp(mix(mortar, .72 + dent + tool * .05 - chip * .25, face), 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec4 c = ashlarCell(uv);
  float id = c.z, k = fract(id * 13.7), m = fract(id * 7.31);
  // Each block from its own part of the bed: paler, darker, warmer or cooler; now and then one with iron in it.
  vec3 stone = mix(vec3(.62, .6, .56), vec3(.76, .74, .7), k);
  stone *= vec3(1. + (m - .5) * .08, 1., 1. - (m - .5) * .08);
  stone = mix(stone, vec3(.66, .54, .4), step(.9, fract(id * 3.9)) * .4);
  stone *= .9 + .2 * fbm(uv + id * 5., vec2(16.), 4, .5);
  vec3 lime = vec3(.7, .67, .6) * (.85 + .15 * fbm(uv + 1.7, vec2(80.), 2, .5));
  float face = smoothstep(.34, .5, h);
  albedo = mix(lime, stone, face) * (1. - cavity * .4) * (.96 + .08 * hash21(floor(uv * 512.)));
  rough = mix(.95, .86, face);
}`},stone:{normalStrength:5.5,height:`
float heightFn(vec2 uv) {
  float broad = fbm(uv, vec2(3.), 5, .55);
  float mid = fbm(uv + 7.3, vec2(12.), 4, .5);
  vec2 w = worley(uv * 22., vec2(22.));
  float pitMask = smoothstep(.12, .32, fbm(uv + 2.1, vec2(4.), 3, .5) + .1);
  float pitSize = .08 + .22 * hash21(floor(uv * 22.) + 3.);
  float pits = smoothstep(pitSize, .0, w.x) * pitMask * step(.55, hash21(floor(uv * 22.) + 11.));
  float tool = gnoise(vec2(uv.x * 14., uv.y * 96.), vec2(14., 96.)) * .5
             + gnoise(vec2(uv.x * 30., uv.y * 180.), vec2(30., 180.)) * .3;
  float grain = fbm(uv + 1.7, vec2(72.), 3, .6);
  float h = .58 + broad * .6 + mid * .26 + tool * .09 + grain * .12 - pits * .3;
  return clamp(h, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float blot = fbm(uv + 9.1, vec2(4.), 4, .5);
  float speck = hash21(floor(uv * 512.));
  vec3 base = mix(vec3(.60, .58, .55), vec3(.74, .72, .68), smoothstep(-.25, .3, blot));
  // Iron staining and a little warm/cool drift.
  float stain = smoothstep(.12, .4, fbm(uv + 13.7, vec2(6.), 4, .55));
  base = mix(base, vec3(.62, .50, .36), stain * .35);
  base *= mix(.86, 1.06, smoothstep(.2, .8, h));
  base *= 1. - cavity * .45;
  base *= .96 + speck * .08;
  albedo = base;
  rough = clamp(.86 + cavity * .1 - smoothstep(.6, .9, h) * .12 + (speck - .5) * .06, .5, 1.);
}`},wood:{normalStrength:4,height:`
float heightFn(vec2 uv) {
  float warp = fbm(uv, vec2(2., 6.), 3, .5) * .12;
  float g1 = gnoise(vec2(uv.x * 4., (uv.y + warp) * 46.), vec2(4., 46.));
  float g2 = gnoise(vec2(uv.x * 9., (uv.y + warp) * 130.), vec2(9., 130.));
  float g3 = gnoise(vec2(uv.x * 20., (uv.y + warp) * 300.), vec2(20., 300.));
  vec2 w = worley(vec2(uv.x * 3., uv.y * 8.), vec2(3., 8.));
  float knot = smoothstep(.16, .0, w.x) * step(.72, hash21(floor(vec2(uv.x * 3., uv.y * 8.)) + .5));
  float checks = smoothstep(.42, .62, g1) * smoothstep(.1, .5, fbm(uv + 5., vec2(3., 3.), 3, .5) + .2);
  float h = .55 + g1 * .34 + g2 * .2 + g3 * .1 - checks * .3 + knot * .15;
  return clamp(h, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float tone = fbm(uv + 3.3, vec2(2., 10.), 4, .5);
  vec3 base = mix(vec3(.20, .13, .08), vec3(.42, .30, .19), smoothstep(.25, .8, h + tone * .5));
  base = mix(base, vec3(.33, .31, .28), smoothstep(.1, .5, fbm(uv + 8., vec2(3., 5.), 3, .5)) * .45);
  base *= 1. - cavity * .55;
  albedo = base;
  rough = clamp(.78 + cavity * .15 - h * .1, .45, 1.);
}`},bark:zt({plate:[10,2],furrow:.12,deep:1,rise:.26,flake:[16,6],flakes:.24,scale:[41,11],scales:.12,fibre:.13,dark:[.05,.04,.035],light:[.5,.45,.39],fresh:[.46,.35,.27],lichen:1,normal:9}),barkAsh:zt({plate:[9,3],furrow:.06,deep:.3,rise:.07,flake:[21,5],flakes:.05,scale:[47,13],scales:.04,fibre:.1,dark:[.17,.16,.15],light:[.55,.54,.5],fresh:[.5,.48,.44],lichen:1.5,normal:6}),barkPine:zt({plate:[5,2],furrow:.1,deep:.6,rise:.2,flake:[13,7],flakes:.3,scale:[29,17],scales:.1,fibre:.05,dark:[.2,.12,.085],light:[.6,.5,.42],fresh:[.6,.38,.27],lichen:.15,normal:8}),barkFir:zt({plate:[13,8],furrow:.1,deep:.4,rise:.3,flake:[27,15],flakes:.14,scale:[53,23],scales:.08,fibre:.06,dark:[.1,.085,.08],light:[.46,.42,.4],fresh:[.42,.33,.3],lichen:.8,normal:8}),moss:{normalStrength:3,height:`
float heightFn(vec2 uv) {
  vec2 w = worley(uv * 14., vec2(14.));
  vec2 w2 = worley(uv * 40. + 3., vec2(40.));
  float clumps = 1. - smoothstep(.0, .75, w.x);
  float tufts = 1. - smoothstep(.0, .8, w2.x);
  float h = clumps * .6 + tufts * .25 + fbm(uv, vec2(6.), 4, .55) * .5 + .12;
  return clamp(h, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(5.), 4, .55);
  vec3 dark = vec3(.035, .065, .018), mid = vec3(.10, .17, .035), dry = vec3(.22, .22, .07);
  vec3 base = mix(dark, mid, smoothstep(.2, .75, h));
  base = mix(base, dry, smoothstep(.1, .45, t) * .55);
  albedo = base * (1. - cavity * .3);
  rough = .96;
}`},rock:{normalStrength:6,height:`
float heightFn(vec2 uv) {
  vec2 warp = vec2(fbm(uv + 1.3, vec2(3.), 4, .55), fbm(uv + 8.9, vec2(3.), 4, .55));
  // A broken face: flat planes at three sizes, the lesser on the greater, meeting in sharp
  // edges. The hollows between them are where the cracks are; none is drawn.
  float broken = (facets(uv * 3. + warp * .6, vec2(3.)) - .3) * .5
               + (facets(uv * 7. + warp * 1.2 + 4.3, vec2(7.)) - .3) * .24
               + (facets(uv * 17. + 9.1, vec2(17.)) - .3) * .1;
  // A few hairline cracks that wander and stop.
  float c1 = abs(fbm(uv + 2.7, vec2(3.), 5, .5));
  float crack = (1. - smoothstep(.0, .009, c1)) * smoothstep(.0, .2, fbm(uv + 11.3, vec2(3.), 3, .5)) * .2;
  float roll = fbm(uv + 3.1, vec2(4.), 4, .55);
  vec2 wp = worley(uv * 30. + 2., vec2(30.));
  float pits = smoothstep(.22, .0, wp.x) * step(.6, hash21(floor(uv * 30. + 2.) + 7.)) * smoothstep(.0, .2, fbm(uv + 2.2, vec2(5.), 3, .5) + .05);
  float grain = fbm(uv + 1.7, vec2(56.), 4, .6);
  return clamp(.5 + broken + roll * .22 + grain * .13 - crack - pits * .2, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float blot = fbm(uv + 9.1, vec2(4.), 4, .5);
  float speck = hash21(floor(uv * 512.));
  vec3 base = mix(vec3(.52, .52, .53), vec3(.72, .70, .67), smoothstep(-.3, .35, blot));
  // Iron in the stone, weathering out warm.
  base = mix(base, vec3(.66, .52, .38), smoothstep(.1, .4, fbm(uv + 13.7, vec2(5.), 4, .55)) * .3);
  // Lichen: pale grey-green and ochre crusts on the high, dry parts.
  vec3 w = worleyId(uv * 11. + 5., vec2(11.));
  float crust = smoothstep(.2, .36, fbm(uv + 21.4, vec2(9.), 4, .6)) * smoothstep(.4, .7, h) * smoothstep(.5, .3, w.x);
  base = mix(base, mix(vec3(.66, .69, .55), vec3(.72, .6, .34), step(.6, w.z)), crust * .6);
  base *= mix(.74, 1.08, smoothstep(.15, .8, h));
  base *= 1. - cavity * .65;
  base *= .95 + speck * .1;
  albedo = base;
  rough = clamp(.9 + cavity * .08 - smoothstep(.6, .9, h) * .1, .55, 1.);
}`},scree:{normalStrength:7,height:`
float lumps(vec2 uv, float n, float share, out float id) {
  vec3 w = worleyId(uv * n + vec2(fbm(uv + n, vec2(4.), 3, .5), fbm(uv + n + 5.3, vec2(4.), 3, .5)) * 1.2, vec2(n));
  id = w.z;
  // Not every cell holds a stone, and those that do hold stones of different sizes.
  float size = mix(.35, .62, fract(w.z * 7.3));
  return step(1. - share, w.z) * smoothstep(size, size * .25, w.x) * smoothstep(.0, .12, w.y - w.x);
}
float heightFn(vec2 uv) {
  float ia, ib, ic;
  float big = lumps(uv, 5., .4, ia) * (.55 + .4 * ia);
  float mid = lumps(uv + 3.7, 11., .7, ib) * (.36 + .25 * ib);
  float small = lumps(uv + 8.1, 26., .9, ic) * (.2 + .12 * ic);
  float grain = fbm(uv + 1.7, vec2(64.), 3, .6);
  return clamp(max(big, max(mid, small)) + .1 + grain * .09 + fbm(uv, vec2(3.), 3, .5) * .1, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib, ic;
  float big = lumps(uv, 5., .4, ia), mid = lumps(uv + 3.7, 11., .7, ib), small = lumps(uv + 8.1, 26., .9, ic);
  float tone = big > .05 ? ia : mid > .05 ? ib : ic;
  vec3 stone = mix(vec3(.44, .43, .43), vec3(.74, .72, .68), fract(tone * 3.7));
  stone = mix(stone, vec3(.6, .5, .38), step(.8, fract(tone * 11.3)) * .5);
  vec3 earth = vec3(.17, .14, .1);
  albedo = mix(earth, stone, smoothstep(.14, .26, h)) * (1. - cavity * .6);
  albedo *= .95 + hash21(floor(uv * 512.)) * .1;
  rough = clamp(.93 + cavity * .05, .6, 1.);
}`},talus:{normalStrength:8,height:`
float shard(vec2 uv, float n, float share, out float id) {
  vec2 x = uv * n + vec2(fbm(uv + n, vec2(4.), 2, .5), fbm(uv + n + 5.3, vec2(4.), 2, .5)) * .45;
  vec2 i = floor(x), f = fract(x), to = vec2(0.);
  float d1 = 9., d2 = 9.;
  id = 0.;
  for (int yy = -1; yy <= 1; yy++) for (int xx = -1; xx <= 1; xx++) {
    vec2 g = vec2(float(xx), float(yy));
    vec2 c = mod(i + g, vec2(n));
    vec2 r = g + hash22(c) - f;
    float d = length(r);
    if (d < d1) { d2 = d1; d1 = d; to = r; id = hash21(c + 17.3); } else if (d < d2) { d2 = d; }
  }
  // Its top is a plane through its own middle, tilted its own way; its edge is where the next piece begins, and is sharp.
  vec2 tilt = (hash22(vec2(id * 91.7, id * 33.1)) - .5) * 1.5;
  float top = .66 + .3 * fract(id * 5.3) - dot(tilt, to);
  return step(1. - share, id) * smoothstep(.0, .06, d2 - d1) * clamp(top, .12, 1.);
}
float heightFn(vec2 uv) {
  float ia, ib, ic;
  float big = shard(uv, 4., .45, ia) * (.62 + .36 * ia);
  float mid = shard(uv + 3.7, 9., .7, ib) * (.4 + .2 * ib);
  float small = shard(uv + 8.1, 22., .92, ic) * (.2 + .1 * ic);
  float grit = fbm(uv + 1.7, vec2(70.), 3, .6);
  return clamp(max(big, max(mid, small)) + .08 + grit * .07 + fbm(uv, vec2(3.), 3, .5) * .08, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib, ic;
  float big = shard(uv, 4., .45, ia), mid = shard(uv + 3.7, 9., .7, ib), small = shard(uv + 8.1, 22., .92, ic);
  float tone = big > .05 ? ia : mid > .05 ? ib : ic;
  // (Grey, without a cast of its own: whoever lays it tints it to the rock it broke from.)
  vec3 stone = vec3(mix(.46, .76, fract(tone * 3.7)));
  // Weathered faces are darker than fresh breaks; a few carry a crust of lichen.
  stone *= mix(.82, 1.06, smoothstep(-.2, .3, fbm(uv + 4.4, vec2(13.), 3, .5)));
  stone = mix(stone, vec3(.5, .52, .36), step(.86, fract(tone * 11.3)) * smoothstep(.1, .3, fbm(uv + 9.9, vec2(31.), 2, .5) + .15) * .55);
  vec3 grit = vec3(.36, .35, .33) * (.85 + .3 * hash21(floor(uv * 256.)));
  albedo = mix(grit, stone, smoothstep(.13, .22, h)) * (1. - cavity * .62);
  albedo *= .95 + hash21(floor(uv * 512.)) * .1;
  rough = clamp(.92 + cavity * .06, .6, 1.);
}`},soil:{normalStrength:5,height:`
float pebbles(vec2 uv, float n, float share, out float id) {
  vec3 w = worleyId(uv * n + vec2(fbm(uv + n, vec2(4.), 3, .5), fbm(uv + n + 5.3, vec2(4.), 3, .5)) * 1.1, vec2(n));
  id = w.z;
  float size = mix(.3, .55, fract(w.z * 7.3));
  return step(1. - share, w.z) * smoothstep(size, size * .3, w.x) * smoothstep(.0, .1, w.y - w.x);
}
float heightFn(vec2 uv) {
  float ia, ib, ic;
  float stones = max(pebbles(uv + 1.1, 9., .2, ia) * (.42 + .25 * ia), max(pebbles(uv + 6.4, 19., .34, ib) * (.26 + .16 * ib), pebbles(uv + 2.9, 41., .5, ic) * (.14 + .08 * ic)));
  // Trodden ground: broad shallow hollows where feet fall, and the grain of dried mud.
  float lie = fbm(uv + 2.3, vec2(4.), 4, .55) * .2 + fbm(uv + 7.1, vec2(17.), 3, .5) * .08;
  float crack = smoothstep(.05, .0, worley(uv * 7. + fbm(uv, vec2(5.), 2, .5) * .6, vec2(7.)).y - worley(uv * 7. + fbm(uv, vec2(5.), 2, .5) * .6, vec2(7.)).x) * .08;
  return clamp(.36 + lie + fbm(uv, vec2(70.), 3, .6) * .06 - crack + stones, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib, ic;
  float a = pebbles(uv + 1.1, 9., .2, ia), b = pebbles(uv + 6.4, 19., .34, ib), c = pebbles(uv + 2.9, 41., .5, ic);
  float tone = a > .05 ? ia : b > .05 ? ib : ic;
  vec3 stone = mix(vec3(.36, .34, .31), vec3(.62, .59, .52), fract(tone * 3.7));
  stone = mix(stone, vec3(.5, .41, .3), step(.75, fract(tone * 11.3)) * .6);
  float damp = fbm(uv + 5.5, vec2(3.), 4, .55), dry = fbm(uv + 9.1, vec2(11.), 3, .5);
  // (Pale: dry trodden earth is the colour of sand, not of chocolate.)
  vec3 earth = mix(vec3(.17, .135, .092), vec3(.33, .27, .19), smoothstep(-.35, .35, damp));
  earth = mix(earth, vec3(.39, .33, .245), smoothstep(.05, .5, dry) * .5);
  albedo = mix(earth, stone, smoothstep(.04, .14, max(a, max(b, c)))) * (1. - cavity * .5);
  albedo *= .93 + hash21(floor(uv * 512.)) * .14;
  rough = .95;
}`},sand:{normalStrength:3,height:`
float bits(vec2 uv, float n, float share, out float id) {
  vec3 w = worleyId(uv * n, vec2(n));
  id = w.z;
  return step(1. - share, w.z) * smoothstep(.32, .12, w.x);
}
float heightFn(vec2 uv) {
  vec2 q = uv + vec2(fbm(uv + 3.3, vec2(3.), 3, .5), fbm(uv + 8.8, vec2(3.), 3, .5)) * .35;
  float ripple = sin((q.x * 2. + q.y) * 6.2832 * 6. + fbm(uv, vec2(6.), 3, .5) * 4.);
  ripple = ripple * .5 + .5;
  ripple = pow(ripple, 1.6) * smoothstep(-.25, .25, fbm(uv + 1.9, vec2(4.), 3, .5));
  float ia, ib;
  float shells = bits(uv + 2.2, 23., .12, ia) * .25 + bits(uv + 7.7, 47., .1, ib) * .15;
  return clamp(.4 + ripple * .16 + fbm(uv, vec2(96.), 2, .6) * .08 + fbm(uv + 4., vec2(8.), 3, .5) * .12 + shells, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float ia, ib;
  float a = bits(uv + 2.2, 23., .12, ia), b = bits(uv + 7.7, 47., .1, ib);
  float drift = fbm(uv + 6.1, vec2(5.), 4, .55);
  vec3 sand = mix(vec3(.74, .67, .52), vec3(.86, .8, .66), smoothstep(-.3, .3, drift));
  // Darker grains gather in the troughs of the ripples, as the heavier ones do.
  sand = mix(sand, vec3(.52, .47, .38), cavity * .7 + smoothstep(.2, .5, fbm(uv + 2.7, vec2(40.), 2, .5)) * .15);
  vec3 shell = mix(vec3(.92, .88, .82), vec3(.45, .43, .44), step(.7, fract(ia * 5.3)));
  albedo = mix(sand, shell, max(a, b));
  albedo *= .9 + hash21(floor(uv * 512.)) * .2;
  rough = .92;
}`},litter:{normalStrength:4.5,height:`
float heightFn(vec2 uv) {
  vec2 warp = vec2(fbm(uv + 3.1, vec2(5.), 3, .5), fbm(uv + 7.7, vec2(5.), 3, .5));
  vec3 a = worleyId(uv * 12. + warp * 1.4, vec2(12.)), b = worleyId(uv * 21. + warp * 2. + 4.4, vec2(21.));
  float plateA = (.42 + .4 * a.z - a.x * .32) * smoothstep(.0, .08, a.y - a.x);
  float plateB = (.3 + .32 * b.z - b.x * .3) * smoothstep(.0, .09, b.y - b.x) * step(.25, b.z);
  float twig = smoothstep(.035, .0, abs(gnoise(vec2(uv.x * 3., uv.y * 11.) + 1.3, vec2(3., 11.)))) * step(.12, fbm(uv + 2., vec2(4.), 2, .5)) * .62;
  return clamp(max(max(plateA, plateB), twig) * .85 + fbm(uv, vec2(60.), 3, .6) * .07 + .07, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec2 warp = vec2(fbm(uv + 3.1, vec2(5.), 3, .5), fbm(uv + 7.7, vec2(5.), 3, .5));
  vec3 a = worleyId(uv * 12. + warp * 1.4, vec2(12.)), b = worleyId(uv * 21. + warp * 2. + 4.4, vec2(21.));
  float plateA = (.42 + .4 * a.z - a.x * .32) * smoothstep(.0, .08, a.y - a.x);
  float plateB = (.3 + .32 * b.z - b.x * .3) * smoothstep(.0, .09, b.y - b.x) * step(.25, b.z);
  float id = plateA >= plateB ? a.z : b.z;
  vec3 leaf = mix(vec3(.13, .085, .045), vec3(.3, .2, .09), fract(id * 5.3));
  leaf = mix(leaf, vec3(.27, .12, .05), step(.72, fract(id * 9.7)) * .7);
  leaf = mix(leaf, vec3(.31, .27, .14), step(.86, fract(id * 3.1)) * .6);
  float twig = smoothstep(.035, .0, abs(gnoise(vec2(uv.x * 3., uv.y * 11.) + 1.3, vec2(3., 11.)))) * step(.12, fbm(uv + 2., vec2(4.), 2, .5));
  vec3 mould = vec3(.045, .036, .026);
  albedo = mix(mould, leaf, smoothstep(.12, .24, max(plateA, plateB)));
  albedo = mix(albedo, vec3(.2, .16, .12), twig * .9) * (1. - cavity * .55);
  albedo *= .92 + hash21(floor(uv * 512.)) * .16;
  rough = .9;
}`},thatch:{normalStrength:5.5,height:`
// Blades lying every which way: each cell of a scattered grid holds one, at its own angle and
// length, centred somewhere in the cell. (Neighbours two cells off are looked at too, since a
// blade may be longer than a cell. The grid wraps, so that the picture tiles.)
float blades(vec2 uv, float n, float seed) {
  vec2 p = uv * n, i = floor(p);
  float m = 0.;
  for (int y = -2; y <= 2; y++) for (int x = -2; x <= 2; x++) {
    vec2 c = i + vec2(float(x), float(y)), cw = mod(c, n);
    float h = hash21(cw + seed), k = hash21(cw + seed + 17.3);
    vec2 d = p - (c + vec2(h, k));
    float a = h * 18.85, len = mix(.7, 1.8, fract(k * 7.3));
    vec2 dir = vec2(cos(a), sin(a));
    float along = dot(d, dir), across = dot(d, vec2(-dir.y, dir.x));
    // A blade is widest at its middle and tapers to its ends, and is a little bent.
    across += along * along * (fract(h * 5.7) - .5) * .12;
    float width = .11 * (1. - along * along / (len * len));
    m = max(m, smoothstep(width, width * .3, abs(across)) * step(abs(along), len) * (.45 + .55 * fract(k * 3.1)));
  }
  return m;
}
float heightFn(vec2 uv) {
  float m = max(blades(uv, 22., 1.), max(blades(uv, 34., 7.) * .85, blades(uv, 52., 13.) * .7));
  return clamp(.16 + m * .72 + fbm(uv, vec2(9.), 3, .5) * .12, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 7.7, vec2(5.), 4, .55), g = fbm(uv + 2.2, vec2(13.), 3, .5);
  vec3 straw = mix(vec3(.36, .3, .17), vec3(.55, .48, .3), smoothstep(.25, .7, h + (t - .5) * .4));
  // Some of it still green, and some gone grey.
  straw = mix(straw, vec3(.2, .26, .1), smoothstep(.1, .5, g) * .45);
  straw = mix(straw, vec3(.42, .41, .36), smoothstep(.2, .55, -g) * .3);
  vec3 gap = vec3(.07, .06, .035);
  albedo = mix(gap, straw, smoothstep(.22, .4, h)) * (1. - cavity * .4) * (.92 + hash21(floor(uv * 512.)) * .16);
  rough = .93;
}`},plaster:{normalStrength:2.2,height:`
float heightFn(vec2 uv) {
  float trowel = fbm(uv + 1.7, vec2(6.), 4, .55);
  float grit = fbm(uv + 5.1, vec2(90.), 2, .5);
  vec3 c = worleyId(uv * 5. + fbm(uv, vec2(4.), 2, .5) * .6, vec2(5.));
  float crack = (1. - smoothstep(.0, .006, c.y - c.x)) * step(.86, c.z);
  return clamp(.55 + (trowel - .5) * .3 + (grit - .5) * .1 - crack * .1, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float stain = fbm(uv + 9.3, vec2(3.), 4, .55), speck = hash21(floor(uv * 512.));
  albedo = vec3(.9, .89, .86) * (.88 + .14 * stain) * (1. - cavity * .4) * (.97 + .06 * speck);
  rough = .88;
}`},brick:{normalStrength:4.5,height:`
vec4 brickAt(vec2 uv) {
  float rows = 26., cols = 9.;
  float row = floor(uv.y * rows), fy = fract(uv.y * rows);
  float x = uv.x * cols + mod(row, 2.) * .5, col = mod(floor(x), cols), fx = fract(x);
  // (How far in from the brick's edge, in metres: a course is 2/26 of a metre high, a brick 2/9 long.)
  float d = min(min(fy, 1. - fy) * (2. / rows), min(fx, 1. - fx) * (2. / cols));
  return vec4(col, row, d, hash21(vec2(col, row) + 1.7));
}
float heightFn(vec2 uv) {
  vec4 b = brickAt(uv);
  float wear = fbm(uv + b.w * 9.1, vec2(30., 80.), 3, .5) * .0018;
  float face = smoothstep(.0045, .0085, b.z + wear);
  float own = (b.w - .5) * .08 + fbm(uv + 3.3, vec2(36., 104.), 3, .5) * .06;
  float mortar = .3 + fbm(uv + 7.7, vec2(72., 208.), 2, .5) * .05;
  return clamp(mix(mortar, .72 + own, face), 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec4 b = brickAt(uv);
  float r2 = hash21(vec2(b.x, b.y) + 8.4), r3 = hash21(vec2(b.x, b.y) + 13.1);
  vec3 brick = mix(vec3(.27, .15, .095), vec3(.43, .25, .15), b.w);
  brick = mix(brick, vec3(.17, .1, .075), step(.86, r2) * .85);
  brick = mix(brick, vec3(.5, .34, .22), step(.93, r3) * .65);
  brick *= .88 + .24 * smoothstep(-.3, .3, fbm(uv + b.w * 5.3, vec2(18., 52.), 3, .5));
  vec3 mortar = vec3(.55, .52, .47) * (.9 + .16 * smoothstep(-.3, .3, fbm(uv + 2.2, vec2(40., 116.), 2, .5)));
  float isBrick = smoothstep(.0045, .0075, b.z);
  vec3 c = mix(mortar, brick, isBrick);
  // (Rain runs down a wall in long streaks, darkening it.)
  c *= .82 + .18 * smoothstep(-.35, .25, fbm(vec2(uv.x, uv.y * .15) + 4.4, vec2(14., 1.), 3, .5));
  albedo = c * (1. - cavity * .35) * (.95 + .1 * hash21(floor(uv * 512.)));
  rough = mix(.94, .86, isBrick);
}`},castle:{normalStrength:1.9,height:`
vec4 blockAt(vec2 uv) {
  // Coursed rubble: each stone the cell of a lattice of points, eight along and twelve up to the picture's four metres, each point
  // moved about in its cell (more along the course than across it, so the courses hold), and some stones grown larger than their
  // neighbours (a cell's distance is less its own weight), so that stones are of many sizes and their joints are anything but
  // straight. (A grid of rectangles, however uneven, read as brick.) (The picture is four metres, not two, and is laid in patches
  // from different places in it, so that a wall does not repeat: see laidUnrepeated in siteMaterial.ts.)
  vec2 cells = vec2(8., 12.), g = uv * cells, ip = floor(g), fp = fract(g);
  float d1 = 9., d2 = 9.; vec2 best = vec2(0.);
  for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++) {
    vec2 o = vec2(float(i), float(j)), cell = mod(ip + o, cells), h = hash22(cell + 3.1);
    vec2 pt = (o + vec2(.5 + (h.x - .5) * .75, .5 + (h.y - .5) * .3) - fp) * (vec2(4.) / cells);
    float d = length(pt) - hash21(cell + 6.7) * .09;
    if (d < d1) { d2 = d1; d1 = d; best = cell; } else if (d < d2) d2 = d;
  }
  // (Half the gap between the two nearest is about how far in from the stone's edge, in metres.)
  return vec4(best.x, best.y, (d2 - d1) * .5, hash21(best + 1.7));
}
float heightFn(vec2 uv) {
  vec4 b = blockAt(uv);
  // (The joint wavers: hammer-dressed stone has no straight edge.)
  float wear = (fbm(uv + b.w * 9.1, vec2(28., 68.), 3, .5) - .5) * .05 + fbm(uv * 3. + b.w, vec2(120.), 2, .5) * .012;
  float face = smoothstep(.006, .034, b.z + wear);
  // (Faces split and dressed flat, with only a little rounding to their edges: domed more, each stone was a cushion.)
  float dome = smoothstep(0., .1, b.z + wear * .5) * .07;
  float rough = fbm(uv + b.w * 3.7, vec2(44.), 4, .55) * .2 + gnoise(vec2(uv.x * 92., uv.y * 192.), vec2(92., 192.)) * .05;
  // (A stone in a few stands proud of the course, and one in a few sits back.)
  float own = (b.w - .5) * .12 + (step(.86, hash21(vec2(b.x, b.y) + 21.3)) - step(.9, hash21(vec2(b.x, b.y) + 33.1))) * .1;
  float mortar = .16 + fbm(uv + 7.7, vec2(128.), 3, .5) * .1;
  return clamp(mix(mortar, .52 + dome + rough + own, face), 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  vec4 b = blockAt(uv);
  float r2 = hash21(vec2(b.x, b.y) + 8.4), r3 = hash21(vec2(b.x, b.y) + 15.9), r4 = hash21(vec2(b.x, b.y) + 27.2);
  // Each stone its own: warmer or cooler, lighter or darker; a few much darker, a few stained ochre with iron.
  vec3 warm = vec3(.76, .7, .62), cool = vec3(.64, .66, .67);
  vec3 stone = mix(cool, warm, r3) * (.8 + .32 * b.w);
  stone = mix(stone, vec3(.46, .44, .42), step(.84, r2) * .75);
  stone = mix(stone, vec3(.72, .58, .4), step(.9, r4) * .55);
  // (Within a stone: mottled.) (The noise is asked at whole multiples of the texture's breadth only, so that it tiles.)
  stone *= .86 + .22 * smoothstep(-.3, .3, fbm(uv + b.w * 5.3, vec2(58., 136.), 4, .55));
  float stain = smoothstep(.1, .5, fbm(uv + 13.7, vec2(8.), 4, .55));
  stone = mix(stone, vec3(.55, .48, .38), stain * .3);
  // Specks of lichen, pale grey-green and yellow, on some stones.
  float lichen = smoothstep(.72, .8, fbm(uv + b.w * 2.1, vec2(96., 192.), 3, .55)) * step(.55, r4);
  stone = mix(stone, mix(vec3(.75, .76, .62), vec3(.72, .64, .32), step(.5, r2)), lichen * .55);
  vec3 mortar = vec3(.62, .59, .54) * (.8 + .2 * smoothstep(-.3, .3, fbm(uv + 2.2, vec2(60.), 3, .5)));
  float isStone = smoothstep(.006, .03, b.z);
  vec3 c = mix(mortar, stone, isStone);
  // (Rain runs down a wall in long streaks, darkening it.) (One cell of the noise from the picture's foot to its head, so that the
  // streaks are long and the picture still meets itself above and below: squeezed upright by a fraction, it did not.)
  c *= .8 + .2 * smoothstep(-.35, .25, fbm(uv + 4.4, vec2(20., 1.), 3, .5));
  albedo = c * (1. - cavity * .4) * (.94 + .12 * hash21(floor(uv * 1024.)));
  rough = mix(.96, .88, isStone);
}`},tile:{normalStrength:6.5,height:`
float heightFn(vec2 uv) {
  float row = floor(uv.y * 8.), fy = fract(uv.y * 8.);
  float x = uv.x * 6. + mod(row, 2.) * .5, fx = fract(x) - .5;
  // The lower end of each tile is round, and shows the tile under it at its corners.
  float body = smoothstep(.0, .07, fy - (.5 - sqrt(max(.25 - fx * fx, 0.))) * .5) * smoothstep(.0, .05, .5 - abs(fx));
  float id = hash21(vec2(floor(x), row) + 3.);
  return clamp((.3 + .5 * (1. - fy) + (id - .5) * .08) * body + .08 + fbm(uv, vec2(48.), 2, .5) * .06, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float row = floor(uv.y * 8.);
  float x = uv.x * 6. + mod(row, 2.) * .5;
  float id = hash21(vec2(floor(x), row) + 3.), worn = fbm(uv + 4.2, vec2(5.), 4, .55);
  vec3 clay = mix(vec3(.5, .2, .12), vec3(.74, .37, .22), id);
  clay = mix(clay, vec3(.3, .2, .16), step(.82, fract(id * 7.3)) * .7);
  clay = mix(clay, vec3(.36, .34, .26), smoothstep(.55, .8, worn) * .45);
  albedo = clay * (1. - cavity * .6) * (.94 + .1 * hash21(floor(uv * 512.)));
  rough = .82;
}`},redBrick:Bt({low:[.27,.075,.045],high:[.42,.15,.085],hard:[.13,.05,.04],soft:[.5,.24,.12]}),buffBrick:Bt({low:[.46,.33,.17],high:[.62,.48,.28],hard:[.3,.2,.12],soft:[.68,.6,.44]}),ground:{normalStrength:3.5,height:`
float heightFn(vec2 uv) {
  float clump = fbm(uv + 4.2, vec2(7.), 4, .55);
  float thatch = gnoise(vec2(uv.x * 40., uv.y * 110.), vec2(40., 110.)) * .5 + gnoise(vec2(uv.x * 120., uv.y * 46.), vec2(120., 46.)) * .5;
  float fine = fbm(uv, vec2(90.), 3, .6);
  return clamp(.5 + clump * .55 + thatch * .22 + fine * .16, 0., 1.);
}`,surface:`
void surfaceFn(vec2 uv, float h, float cavity, out vec3 albedo, out float rough) {
  float t = fbm(uv + 5.5, vec2(5.), 4, .55);
  vec3 grass = mix(vec3(.05, .095, .022), vec3(.10, .17, .035), smoothstep(.3, .75, h));
  grass = mix(grass, vec3(.19, .2, .06), smoothstep(.1, .45, t) * .45);
  vec3 earth = vec3(.11, .085, .05);
  albedo = mix(grass, earth, smoothstep(.42, .26, h) * .8) * (1. - cavity * .35);
  rough = .96;
}`}};function Ht(e){return`
precision highp float;
varying vec2 vUv;
uniform int uMode;
uniform float uTexel;
${Rt}
${e.height}
${e.surface}
void main() {
  float h = heightFn(vUv);
  float e = uTexel;
  float hl = heightFn(vUv - vec2(e, 0.)), hr = heightFn(vUv + vec2(e, 0.));
  float hd = heightFn(vUv - vec2(0., e)), hu = heightFn(vUv + vec2(0., e));
  // Cavity: how far this point sits below its wider surroundings.
  float e2 = e * 6.;
  float around = .25 * (heightFn(vUv - vec2(e2, 0.)) + heightFn(vUv + vec2(e2, 0.))
                      + heightFn(vUv - vec2(0., e2)) + heightFn(vUv + vec2(0., e2)));
  float cavity = clamp((around - h) * 5., 0., 1.);
  if (uMode == 0) {
    vec3 albedo; float rough;
    surfaceFn(vUv, h, cavity, albedo, rough);
    gl_FragColor = vec4(albedo, h);
  } else if (uMode == 1) {
    vec3 n = normalize(vec3((hl - hr) * ${e.normalStrength.toFixed(2)}, (hd - hu) * ${e.normalStrength.toFixed(2)}, 2. * e * 512.));
    gl_FragColor = vec4(n * .5 + .5, 1.);
  } else {
    vec3 albedo; float rough;
    surfaceFn(vUv, h, cavity, albedo, rough);
    gl_FragColor = vec4(1. - cavity * .7, rough, 0., 1.);
  }
}`}var Ut=null;function Wt(){Ut?.dispose(),Ut?.forceContextLoss(),Ut=null}function Gt(i,o,s){let c=Ut??=new C({canvas:document.createElement(`canvas`),antialias:!1}),l=Vt[i],d=new u({uniforms:{uMode:{value:0},uTexel:{value:1/o},uSeed:{value:s}},vertexShader:`varying vec2 vUv; void main(){ vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`,fragmentShader:Ht(l),depthTest:!1,depthWrite:!1}),f=new p,m=new S(new g(2,2),d);m.frustumCulled=!1,f.add(m);let v=new y(-1,1,1,-1,0,1),b=[],w=(i,s)=>{let l=new e(o,o,{format:x,type:n,depthBuffer:!1,generateMipmaps:!1,colorSpace:s?h:``});d.uniforms.uMode.value=i,c.setRenderTarget(l),c.render(f,v);let u=new Uint8Array(o*o*4);c.readRenderTargetPixels(l,0,0,o,o,u),c.setRenderTarget(null),l.dispose(),b.push(u);let p=new t(u,o,o,x,n);return p.wrapS=p.wrapT=_,p.minFilter=a,p.magFilter=r,p.generateMipmaps=!0,p.anisotropy=8,p.colorSpace=s?h:``,p.needsUpdate=!0,p};c.toneMapping=0;let T={map:w(0,!0),normalMap:w(1,!1),ormMap:w(2,!1),pixels:b,size:o};return d.dispose(),m.geometry.dispose(),T}var Kt=class{data;length=0;constructor(e){this.data=new Float32Array(e)}ensure(e){if(this.length+e<=this.data.length)return;let t=this.data.length*2;for(;t<this.length+e;)t*=2;let n=new Float32Array(t);n.set(this.data.subarray(0,this.length)),this.data=n}trimmed(){return this.data.slice(0,this.length)}},qt=class{pos=new Kt(49152);nrm=new Kt(49152);uv=new Kt(32768);col=new Kt(49152);fld=new Kt(65536);idx=[];bakeSource=[];bakeScale=[];sky=[];edges={data:new Uint8Array};vertexCount=0;addVertex(e,t,n,r,i,a,o,s,c,l,u,d=0,f=0,p=0,m=0){let h=this.vertexCount++;this.pos.ensure(3),this.nrm.ensure(3),this.uv.ensure(2),this.col.ensure(3),this.fld.ensure(4);let g=this.pos,_=this.nrm,v=this.uv,y=this.col,b=this.fld;return g.data[g.length++]=e,g.data[g.length++]=t,g.data[g.length++]=n,_.data[_.length++]=r,_.data[_.length++]=i,_.data[_.length++]=a,v.data[v.length++]=o,v.data[v.length++]=s,y.data[y.length++]=c,y.data[y.length++]=l,y.data[y.length++]=u,b.data[b.length++]=d,b.data[b.length++]=f,b.data[b.length++]=p,b.data[b.length++]=m,h}setBakeSource(e,t,n){this.bakeSource[e]=t,this.bakeScale[e]=n}setOpen(e,t){this.sky[e]=t}openAt(e){return this.sky[e]??1}bakePlan(){let e=new Int32Array(this.vertexCount),t=new Float32Array(this.vertexCount);for(let n=0;n<this.vertexCount;n++){let r=this.bakeSource[n];e[n]=r===void 0?n:r,t[n]=r===void 0?1:this.bakeScale[n]}return{source:e,scale:t}}setOpenBy(e,t=0){for(let n=t;n<this.vertexCount;n++)this.setOpen(n,e(this.pos.data[n*3],this.pos.data[n*3+1],this.pos.data[n*3+2]))}movePoints(e,t=0){let n=[0,0,0],r=this.pos.data;for(let i=t;i<this.vertexCount;i++)n[0]=r[i*3],n[1]=r[i*3+1],n[2]=r[i*3+2],e(n),r[i*3]=n[0],r[i*3+1]=n[1],r[i*3+2]=n[2]}own=null;setLightBy(e){this.own=new Float32Array(this.vertexCount*13);let t=[0,0,0],n=[0,0,0],r=new Float32Array(13);for(let i=0;i<this.vertexCount;i++){for(let e=0;e<3;e++)t[e]=this.pos.data[i*3+e],n[e]=this.nrm.data[i*3+e];r.fill(0),e(t,n,r),this.own.set(r,i*13)}}eachTriangle(e){let t=this.pos.data,n=this.nrm.data;for(let r=0;r<this.idx.length;r+=3){let i=this.idx[r],a=this.idx[r+1],o=this.idx[r+2];e(i,a,o,(t[i*3]+t[a*3]+t[o*3])/3,(t[i*3+1]+t[a*3+1]+t[o*3+1])/3,(t[i*3+2]+t[a*3+2]+t[o*3+2])/3,n[i*3],n[i*3+1],n[i*3+2])}}setField(e,t){for(let n=0;n<this.vertexCount;n++){let r=t(this.pos.data[n*3],this.pos.data[n*3+1],this.pos.data[n*3+2]);r!==void 0&&(this.fld.data[n*4+e]=r)}}append(e,t){let n=this.vertexCount,r={p:[0,0,0],n:[0,0,0],colour:[0,0,0],field:[0,0,0,0],open:1};for(let n=0;n<e.vertexCount;n++){for(let t=0;t<3;t++)r.p[t]=e.pos.data[n*3+t],r.n[t]=e.nrm.data[n*3+t],r.colour[t]=e.col.data[n*3+t];for(let t=0;t<4;t++)r.field[t]=e.fld.data[n*4+t];r.open=e.openAt(n),t(r);let i=this.addVertex(r.p[0],r.p[1],r.p[2],r.n[0],r.n[1],r.n[2],e.uv.data[n*2],e.uv.data[n*2+1],r.colour[0],r.colour[1],r.colour[2],r.field[0],r.field[1],r.field[2],r.field[3]);this.setOpen(i,r.open)}let i=e.edges.data;if(i.length){let t=Math.min(e.vertexCount,i.length>>2);for(let e=0;e<t;e++)i[e*4+2]&&this.markCopied(n+e,i[e*4],i[e*4+1],i[e*4+2])}for(let t=0;t<e.idx.length;t+=3)this.addTriangle(e.idx[t]+n,e.idx[t+1]+n,e.idx[t+2]+n)}markFace(e){if(e.length!==3&&e.length!==4)return;let t=this.edges,n=(Math.max(...e)+1)*4;if(t.data.length<n){let e=Math.max(1024,t.data.length);for(;e<n;)e*=2;let r=new Uint8Array(e);r.set(t.data),t.data=r}let r=e.length===4?[[0,0],[255,0],[255,255],[0,255]]:[[0,0],[255,0],[0,255]],i=e.length===4?128:255;e.forEach((e,n)=>{t.data[e*4]=r[n][0],t.data[e*4+1]=r[n][1],t.data[e*4+2]=i})}addTriangle(e,t,n){this.idx.push(e,t,n)}markCopied(e,t,n,r){let i=this.edges,a=(e+1)*4;if(i.data.length<a){let e=Math.max(1024,i.data.length);for(;e<a;)e*=2;let t=new Uint8Array(e);t.set(i.data),i.data=t}i.data[e*4]=t,i.data[e*4+1]=n,i.data[e*4+2]=r}get triangleCount(){return this.idx.length/3}build(){let e=new v;e.setAttribute(`position`,new f(this.pos.trimmed(),3)),e.setAttribute(`normal`,new f(this.nrm.trimmed(),3)),e.setAttribute(`uv`,new f(this.uv.trimmed(),2)),e.setAttribute(`color`,new f(this.col.trimmed(),3)),e.setAttribute(`aField`,new f(this.fld.trimmed(),4));let t=this.vertexCount,n=new d(new Float32Array(t*14),14);e.setAttribute(`aSHr`,new m(n,4,0)),e.setAttribute(`aSHg`,new m(n,4,4)),e.setAttribute(`aSHb`,new m(n,4,8)),e.setAttribute(`aBake`,new m(n,2,12));let r=new Uint8Array(t*4);return r.set(this.edges.data.subarray(0,Math.min(this.edges.data.length,t*4))),e.setAttribute(`aEdge`,new f(r,4,!0)),e.setIndex(new f(new Uint32Array(this.idx),1)),e.computeBoundingBox(),e.computeBoundingSphere(),e}};export{Fe as A,De as C,pt as D,ct as E,Me as O,ft as S,At as T,Tt as _,Mt as a,ke as b,at as c,xt as d,Ot as f,St as g,Xe as h,Ue as i,Et as j,Qe as k,Ct as l,jt as m,Wt as n,wt as o,kt as p,Gt as r,nt as s,qt as t,Lt as u,Dt as v,He as w,Te as x,Oe as y};