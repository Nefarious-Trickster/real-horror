import sys, os, numpy as np, soundfile as sf, matplotlib
matplotlib.use('Agg'); import matplotlib.pyplot as plt
ids=sys.argv[2:]; out=sys.argv[1]
fig,axs=plt.subplots(len(ids),2,figsize=(14,2.2*len(ids)),gridspec_kw={'width_ratios':[3,1]})
axs=np.atleast_2d(axs)
for k,i in enumerate(ids):
    x,sr=sf.read(os.path.join('render',i+'.wav'))
    if x.ndim==2: x=x.mean(1)
    a=axs[k,0]; a.specgram(x,NFFT=1024,Fs=sr,noverlap=768,cmap='magma',vmin=-130); a.set_ylim(0,12000); a.set_title(i,fontsize=8,loc='left')
    t=np.arange(len(x))/sr; axs[k,1].plot(t,x,lw=0.3); axs[k,1].set_ylim(-1,1)
plt.tight_layout(); plt.savefig(out,dpi=60)
