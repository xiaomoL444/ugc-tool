package primitive

import "math"

// Alpha constraints are part of candidate scoring, including every hill-climb
// mutation. Exported shapes do not depend on a separate clipping bitmap.
func (w *Worker) SetAlphaMask(alpha []byte) {
	w.AlphaMask = append([]byte(nil), alpha...)
	w.Foreground = nil
	w.EdgeDistance = make([]float64, w.W*w.H)
	for i, a := range alpha {
		if a > 0 {
			w.Foreground = append(w.Foreground, i)
			x, y := i%w.W, i/w.W
			w.EdgeDistance[i] = float64(minInt(minInt(x+1, w.W-x), minInt(y+1, w.H-y)))
		}
	}
	// A Manhattan distance field supplies conservative seed radii. Candidates
	// can grow during optimization as long as their complete footprint passes.
	for y:=0; y<w.H; y++ { for x:=0; x<w.W; x++ {
		i:=y*w.W+x
		if x>0 { w.EdgeDistance[i]=math.Min(w.EdgeDistance[i],w.EdgeDistance[i-1]+1) }
		if y>0 { w.EdgeDistance[i]=math.Min(w.EdgeDistance[i],w.EdgeDistance[i-w.W]+1) }
	} }
	for y:=w.H-1; y>=0; y-- { for x:=w.W-1; x>=0; x-- {
		i:=y*w.W+x
		if x+1<w.W { w.EdgeDistance[i]=math.Min(w.EdgeDistance[i],w.EdgeDistance[i+1]+1) }
		if y+1<w.H { w.EdgeDistance[i]=math.Min(w.EdgeDistance[i],w.EdgeDistance[i+w.W]+1) }
	} }
}

func (w *Worker) maskedSeed(t ShapeType) Shape {
	i:=w.Foreground[w.Rnd.Intn(len(w.Foreground))]
	x,y:=float64(i%w.W)+0.5,float64(i/w.W)+0.5
	r:=math.Max(0.35,w.EdgeDistance[i]*0.45)
	rx,ry:=math.Max(0.35,w.Rnd.Float64()*r),math.Max(0.35,w.Rnd.Float64()*r)
	switch t {
	case ShapeTypeRotatedEllipse:
		return &RotatedEllipse{Worker:w,X:x,Y:y,Rx:rx,Ry:ry,Angle:w.Rnd.Float64()*360}
	case ShapeTypeRotatedRectangle:
		return &RotatedRectangle{Worker:w,X:int(x),Y:int(y),Sx:maxInt(1,int(rx*2)),Sy:maxInt(1,int(ry*2)),Angle:w.Rnd.Intn(360)}
	case ShapeTypeTriangle:
		s:=maxInt(1,int(r))
		return &Triangle{Worker:w,X1:int(x),Y1:int(y)-s,X2:int(x)-s,Y2:int(y)+s,X3:int(x)+s,Y3:int(y)+s}
	}
	return nil
}

func (w *Worker) AllowsShape(s Shape) bool { return w.maskAllows(s,s.Rasterize()) }

func (w *Worker) maskAllows(s Shape, lines []Scanline) bool {
	if w.AlphaMask==nil { return true }
	// Rasterizers clip at the image rectangle. Check the real geometric bounds
	// as well, so an exported ellipse cannot hide most of its area off-canvas.
	inside:=func(x,y,ex,ey float64) bool { return x-ex>=0 && y-ey>=0 && x+ex<=float64(w.W) && y+ey<=float64(w.H) }
	switch v:=s.(type) {
	case *RotatedEllipse:
		c,sn:=math.Cos(radians(v.Angle)),math.Sin(radians(v.Angle))
		if !inside(v.X,v.Y,math.Hypot(v.Rx*c,v.Ry*sn),math.Hypot(v.Rx*sn,v.Ry*c)) { return false }
	case *RotatedRectangle:
		c,sn:=math.Abs(math.Cos(radians(float64(v.Angle)))),math.Abs(math.Sin(radians(float64(v.Angle))))
		if !inside(float64(v.X),float64(v.Y),(float64(v.Sx)*c+float64(v.Sy)*sn)/2,(float64(v.Sx)*sn+float64(v.Sy)*c)/2) { return false }
	case *Triangle:
		if !inside(float64(v.X1),float64(v.Y1),0,0)||!inside(float64(v.X2),float64(v.Y2),0,0)||!inside(float64(v.X3),float64(v.Y3),0,0) { return false }
	}
	var total,outside float64
	for _,line:=range lines {
		weight:=float64(line.Alpha)/65535
		for x:=line.X1;x<=line.X2;x++ {
			total+=weight
			if w.AlphaMask[line.Y*w.W+x]==0 { outside+=weight }
		}
	}
	// Permit only the fractional raster fringe, not substantial transparent areas.
	return total>0 && outside<=total*0.01
}
