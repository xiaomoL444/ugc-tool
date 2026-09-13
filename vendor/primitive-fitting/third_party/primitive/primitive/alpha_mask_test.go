package primitive

import (
  "image"
  "testing"
)

func TestAlphaMaskRejectsBackgroundAndClippedShapes(t *testing.T) {
  worker:=NewWorker(image.NewRGBA(image.Rect(0,0,32,32)))
  alpha:=make([]byte,32*32)
  for y:=8;y<24;y++ { for x:=8;x<24;x++ { alpha[y*32+x]=255 } }
  worker.SetAlphaMask(alpha)
  cases:=[]struct{name string; shape Shape; allowed bool}{
    {"inside", &RotatedEllipse{Worker:worker,X:16,Y:16,Rx:4,Ry:6},true},
    {"background circle", &RotatedEllipse{Worker:worker,X:16,Y:16,Rx:15,Ry:15},false},
    {"off canvas", &RotatedEllipse{Worker:worker,X:16,Y:16,Rx:100,Ry:100},false},
    {"background rectangle", &RotatedRectangle{Worker:worker,X:3,Y:3,Sx:4,Sy:4},false},
  }
  for _,c:=range cases { if got:=worker.AllowsShape(c.shape);got!=c.allowed {t.Errorf("%s: got %v",c.name,got)} }
  worker.Init(image.NewRGBA(image.Rect(0,0,32,32)),0)
  if worker.Energy(cases[1].shape,128)!=1e9 {t.Fatal("invalid geometry must be rejected while optimizing")}
  worker.SetAlphaMask(make([]byte,32*32))
  if worker.AllowsShape(cases[0].shape) {t.Fatal("fully transparent mask must not accept shapes")}
}

func TestOpaqueFittingHasNoMaskConstraint(t *testing.T) {
  worker:=NewWorker(image.NewRGBA(image.Rect(0,0,32,32)))
  if !worker.AllowsShape(&RotatedEllipse{Worker:worker,X:16,Y:16,Rx:30,Ry:30}) {t.Fatal("opaque mode changed")}
}
