# Run an exported learner/model from fast-AI on an image
# With additional heatmaps shown.
# Adapted from the FastAI lession 6 - pets with heatmaps.
# Note:
# Assumes that there is a learned model in the current folder

import sys, cv2, PIL, numpy as np
from fastai.callbacks.hooks import *
from fastai.vision import *

global m
global xb

def hooked_backward(cat = 0):
    with hook_output(m[0]) as hook_a:
        with hook_output(m[0], grad=True) as hook_g:
            preds = m(xb)
            preds[0,int(cat)].backward()
    return hook_a,hook_g

def show_heatmap(hm):
    _,ax = plt.subplots()
    xb_im.show(ax)
    ax.imshow(hm, alpha=0.6, extent=(0,xb_im.shape[2], xb_im.shape[1],0),
              interpolation='bilinear', cmap='magma')
    return ax

learn = load_learner(".")

if len(sys.argv) > 1:
    img = open_image(sys.argv[1])
else:
    camera = cv2.VideoCapture(0)
    _, frame = camera.read()
    img = Image(pil2tensor(frame, dtype=np.float32).div_(255))

_,_,losses = learn.predict(img)
prediction = sorted(zip(learn.data.classes, map(float, losses)),
                    key=lambda p: p[1], reverse=True)

m = learn.model.eval()
xb,_ = learn.data.one_item(img)
xb_im = img

cl = learn.data.classes.index(prediction[0][0])
print("Class:", cl)

hook_a,hook_g = hooked_backward(cl)

# Heatmap over all activations
acts  = hook_a.stored[0].cpu()
avg_acts = acts.mean(0)
show_heatmap(avg_acts)

# Heatmap over a specific class
>>>>>>> added heatmap test
grad = hook_g.stored[0][0].cpu()
grad_chan = grad.mean(1).mean(1)
grad.shape,grad_chan.shape
mult = (acts*grad_chan[...,None,None]).mean(0)

maxV = 0.0
for x in range(0, mult.shape[0]):
    for y in range(0, mult.shape[1]):
        v = mult[x][y]
        print(" % .6f "%v, end='')
        if v > maxV:
            maxX = x
            maxY = y
            maxV = v
    print("")

ax = show_heatmap(mult)

# Show some text at the point of maximum "heat".
ax.text(0.001 + 1.0 * maxY / y, -0.001 + 1.0 -  maxX / x, prediction[0][0],
        horizontalalignment='center',
        verticalalignment='top',
        fontsize=20, color='black',
        transform=ax.transAxes)
ax.text(1.0 * maxY / y, 1.0 -  maxX / x, prediction[0][0],
        horizontalalignment='center',
        verticalalignment='top',
        fontsize=20, color='white',
        transform=ax.transAxes)

print("Prediction:", prediction, cl)
plt.show()
