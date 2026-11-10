import { CONN_ELBOW_GAP, CONN_ELBOW_RADIUS } from "./constants.js";

/* The shapes connections are drawn as, worked out from two anchor points and
 * the side of its block each one leaves or enters by.
 *
 * Everything here is pure geometry on plain {x,y} points and {x,y,w,h}
 * rectangles -- no DOM, no state -- so it can be tested with explicit numbers
 * (jsdom has no layout to measure). connections.js decides *which* points and
 * sides to feed in; this module only draws between them.
 *
 * A side is "t", "r", "b" or "l": the side of the block the line meets,
 * which is also the direction it travels to leave it. A route enters its
 * far end travelling the opposite way, i.e. perpendicular to that side.
 */

export const SIDE_VEC = { t:{x:0,y:-1}, r:{x:1,y:0}, b:{x:0,y:1}, l:{x:-1,y:0} };

const round2 = (n)=>Math.round(n*100)/100;
const pt = (p)=>round2(p.x)+" "+round2(p.y);
const same = (a,b)=>Math.abs(a.x-b.x)<1e-6 && Math.abs(a.y-b.y)<1e-6;
const horizontal = (side)=>side==="l" || side==="r";

/* The side of `rect` that faces the point (tx, ty): the one a ray from the
   rectangle's centre toward it crosses first. This is the same test the
   straight line's rectangle clip uses, so "automatic" agrees with it. */
export function autoSide(rect, tx, ty){
  const hw = rect.w/2, hh = rect.h/2;
  const dx = tx-(rect.x+hw), dy = ty-(rect.y+hh);
  if(dx===0 && dy===0) return "r";
  if(Math.abs(dx)*hh >= Math.abs(dy)*hw) return dx>=0 ? "r" : "l";
  return dy>0 ? "b" : "t";
}

/* Drop repeated points, and any middle point the path simply carries straight
   on through, so a perfectly aligned pair collapses to one segment. A point
   where the path doubles back on itself is kept. */
function simplify(pts){
  const out = [];
  for(const p of pts){
    if(out.length && same(out[out.length-1], p)) continue;
    out.push(p);
  }
  for(let i=1; i<out.length-1;){
    const a=out[i-1], b=out[i], c=out[i+1];
    const cross = (b.x-a.x)*(c.y-b.y) - (b.y-a.y)*(c.x-b.x);
    const dot = (b.x-a.x)*(c.x-b.x) + (b.y-a.y)*(c.y-b.y);
    if(Math.abs(cross)<1e-6 && dot>0) out.splice(i,1); else i++;
  }
  if(out.length===1) out.push({ x:out[0].x, y:out[0].y });
  return out;
}

/* The corner points of an orthogonal route from p1 (leaving by side s1) to p2
   (entering by side s2): two or three segments, one or two bends, with no
   regard for what is in the way.
     - one side horizontal and the other vertical: an L, one bend.
     - both horizontal (or both vertical): a Z through the halfway line, or,
       when both sides face the same way, a C that runs `gap` out past both
       points first. Two bends.
   Anything collinear collapses, so a pair that lines up exactly is one
   straight segment. */
export function elbowPoints(p1, s1, p2, s2, gap){
  const g = gap===undefined ? CONN_ELBOW_GAP : gap;
  const h1 = horizontal(s1), h2 = horizontal(s2);
  let pts;
  if(h1 && h2){
    const mx = s1===s2
      ? (s1==="r" ? Math.max(p1.x,p2.x)+g : Math.min(p1.x,p2.x)-g)
      : (p1.x+p2.x)/2;
    pts = [p1, {x:mx,y:p1.y}, {x:mx,y:p2.y}, p2];
  } else if(!h1 && !h2){
    const my = s1===s2
      ? (s1==="b" ? Math.max(p1.y,p2.y)+g : Math.min(p1.y,p2.y)-g)
      : (p1.y+p2.y)/2;
    pts = [p1, {x:p1.x,y:my}, {x:p2.x,y:my}, p2];
  } else if(h1){
    pts = [p1, {x:p2.x,y:p1.y}, p2];
  } else {
    pts = [p1, {x:p1.x,y:p2.y}, p2];
  }
  return simplify(pts);
}

/* An SVG path through `pts` with each bend rounded off by `radius`, never more
   than half of either neighbouring segment. The last segment is left straight
   to the end point, so an arrowhead lines up with it exactly. */
export function roundedPath(pts, radius){
  const r0 = radius===undefined ? CONN_ELBOW_RADIUS : radius;
  let d = "M"+pt(pts[0]);
  for(let i=1; i<pts.length-1; i++){
    const prev = pts[i-1], cur = pts[i], next = pts[i+1];
    const lenIn = Math.hypot(cur.x-prev.x, cur.y-prev.y);
    const lenOut = Math.hypot(next.x-cur.x, next.y-cur.y);
    const r = Math.min(r0, lenIn/2, lenOut/2);
    if(r<=0){ d += " L"+pt(cur); continue; }
    const a = { x:cur.x-(cur.x-prev.x)/lenIn*r, y:cur.y-(cur.y-prev.y)/lenIn*r };
    const b = { x:cur.x+(next.x-cur.x)/lenOut*r, y:cur.y+(next.y-cur.y)/lenOut*r };
    d += " L"+pt(a)+" Q"+pt(cur)+" "+pt(b);
  }
  return d+" L"+pt(pts[pts.length-1]);
}

/* Where a label sits on a polyline: the middle of the middle segment for the
   three-segment shapes, otherwise halfway along its length. */
export function polylineMid(pts){
  if(pts.length===4) return { x:(pts[1].x+pts[2].x)/2, y:(pts[1].y+pts[2].y)/2 };
  let total = 0;
  for(let i=1;i<pts.length;i++) total += Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
  let left = total/2;
  for(let i=1;i<pts.length;i++){
    const len = Math.hypot(pts[i].x-pts[i-1].x, pts[i].y-pts[i-1].y);
    if(len>0 && left<=len){
      const t = left/len;
      return { x:pts[i-1].x+(pts[i].x-pts[i-1].x)*t, y:pts[i-1].y+(pts[i].y-pts[i-1].y)*t };
    }
    left -= len;
  }
  return { x:pts[pts.length-1].x, y:pts[pts.length-1].y };
}

/* A smooth cubic Bezier that leaves p1 and arrives at p2 perpendicular to
   their sides. The handles are 40% of the distance (kept between 30 and 160
   px) so a short link still bows visibly and a long one does not balloon. */
export function curveGeometry(p1, s1, p2, s2){
  const k = Math.min(160, Math.max(30, Math.hypot(p2.x-p1.x, p2.y-p1.y)*0.4));
  const v1 = SIDE_VEC[s1], v2 = SIDE_VEC[s2];
  const c1 = { x:p1.x+v1.x*k, y:p1.y+v1.y*k };
  const c2 = { x:p2.x+v2.x*k, y:p2.y+v2.y*k };
  return {
    c1, c2,
    d: "M"+pt(p1)+" C"+pt(c1)+" "+pt(c2)+" "+pt(p2),
    mid: { x:(p1.x+3*c1.x+3*c2.x+p2.x)/8, y:(p1.y+3*c1.y+3*c2.y+p2.y)/8 },
  };
}

/* The path and label position for an elbow or curve route. */
export function routeGeometry(route, p1, s1, p2, s2){
  if(route==="curve"){
    const c = curveGeometry(p1, s1, p2, s2);
    return { d:c.d, mid:c.mid };
  }
  const pts = elbowPoints(p1, s1, p2, s2);
  return { d:roundedPath(pts), mid:polylineMid(pts), points:pts };
}
