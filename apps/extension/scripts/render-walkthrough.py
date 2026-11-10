import argparse,json,re,subprocess,textwrap,base64
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('evidence');p.add_argument('provider',choices=['gitlab','bitbucket']);p.add_argument('--continuation');p.add_argument('--out',default='/workspace/artifacts/provider-walkthroughs');a=p.parse_args()
source=Path(a.evidence).resolve();out=Path(a.out).resolve();out.mkdir(parents=True,exist_ok=True);work=out/('.'+a.provider);work.mkdir(exist_ok=True)
data=json.loads((source/f'{a.provider}-walkthrough.json').read_text());raw=source/data['file']
assert data['scenes'], 'No completed scenes to render'
for scene in data['scenes']:scene['source_path']=str(raw)
if a.continuation:
 extra_source=Path(a.continuation).resolve();extra=json.loads((extra_source/f'{a.provider}-walkthrough.json').read_text())
 for scene in extra['scenes']:scene['source_path']=str(extra_source/extra['file'])
 data['scenes'].extend(extra['scenes']);data['omitted'].extend(extra.get('omitted',[]))

required={'orientation','digest','counts','tests','settings','finish'}
assert required.issubset({scene['id'] for scene in data['scenes']}), 'Walkthrough capture is incomplete'
edited=[]
for scene in data['scenes']:
 if scene['id']=='tests':
  scene={**scene,'narration':'The Tests category brings hidden test files back into the file tree. Their original diffs are available below the essential files.'}
 if scene['id']=='flow' and scene['end']-scene['start']>5:
  scene={**scene,'end':scene['end']-4.15,'narration':'Flow opens a graph of the changed files and their dependencies.'}
 if scene['id']=='restore' and scene['end']-scene['start']>5:
  edited.append({**scene,'id':'native-diff','end':scene['start']+2.1,'narration':'Turning Geld off restores the original full diff and native counts.'})
  edited.append({**scene,'id':'restore','start':scene['start']+2.7,'title':'Return to the categorised review','narration':'Turning Geld back on returns to the same categorised review.'})
 else:edited.append(scene)
data['scenes']=edited
def run(args):
 result=subprocess.run(args,stdout=subprocess.DEVNULL,stderr=subprocess.PIPE)
 if result.returncode:raise RuntimeError(result.stderr.decode(errors='replace')[-4000:])
def duration(path):return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','default=nw=1:nk=1',str(path)],text=True))
def stamp(t,comma=False):
 h=int(t//3600);m=int(t%3600//60);s=t%60
 return f'{h:02}:{m:02}:{s:06.3f}'.replace('.',',' if comma else '.')
def ass_time(t):return f'{int(t//3600)}:{int(t%3600//60):02}:{t%60:05.2f}'
font='/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf';bold='/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf'
segments=[];cues=[];chapters=[];cursor=0
for i,scene in enumerate(data['scenes']):
 raw=Path(scene['source_path'])
 phrases=re.split(r'(?<=[.!?])\s+',scene['narration'].strip());audio_files=[];local=[];offset=.5
 for j,phrase in enumerate(phrases):
  text=work/f'{i:02}-{j:02}.txt';text.write_text(phrase);wav=work/f'{i:02}-{j:02}.wav'
  run(['ffmpeg','-y','-v','error','-f','lavfi','-i',f'flite=textfile={text}:voice=slt','-ar','48000','-ac','1',str(wav)])
  length=duration(wav);audio_files.append(wav);local.append((offset,offset+length,phrase));offset+=length
 audio_list=work/f'{i:02}-audio.txt';audio_list.write_text(''.join(f"file '{x}'\n" for x in audio_files));audio=work/f'{i:02}-speech.wav'
 run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(audio_list),'-c','copy',str(audio)])
 total=max(scene['end']-scene['start']+.8,offset+.55)
 title=work/f'{i:02}-title.txt';label=('GitLab' if a.provider=='gitlab' else 'Bitbucket')+'  |  '+scene['title'].split(' · ')[-1];title.write_text(label)
 ass=work/f'{i:02}.ass';header='''[Script Info]
ScriptType: v4.00+
PlayResX: 1440
PlayResY: 1180
WrapStyle: 0
[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,DejaVu Sans,29,&H00FFFFFF,&H0000FFFF,&H00101925,&H00101925,0,0,0,0,100,100,0,0,1,1,0,2,60,60,26,1
[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
'''
 events=[]
 for start,end,text in local:
  wrapped='\\N'.join(textwrap.wrap(text,86));events.append(f'Dialogue: 0,{ass_time(start)},{ass_time(end)},Default,,0,0,0,,{wrapped}')
  cues.append((cursor+start,cursor+end,text))
 ass.write_text(header+'\n'.join(events)+'\n')
 vf=f"setpts=PTS-STARTPTS,tpad=start_mode=clone:start_duration=0.8:stop_mode=clone:stop_duration={total},scale=1440:1000:force_original_aspect_ratio=decrease,pad=1440:1180:(ow-iw)/2:80:color=0x101925,drawtext=fontfile={bold}:textfile={title}:fontcolor=white:fontsize=30:x=42:y=24,ass={ass}"
 target=work/f'{i:02}.mp4'
 run(['ffmpeg','-y','-v','error','-ss',f"{scene['start']:.6f}",'-t',f"{scene['end']-scene['start']:.6f}",'-i',str(raw),'-i',str(audio),'-vf',vf,'-af','adelay=500,apad','-t',f'{total:.6f}','-r','24','-c:v','libx264','-preset','fast','-crf','20','-pix_fmt','yuv420p','-c:a','aac','-b:a','128k','-movflags','+faststart',str(target)])
 total=duration(target)
 segments.append(target);chapters.append((cursor,cursor+total,scene['title']));cursor+=total
 print(f'{a.provider}: rendered {i+1}/{len(data["scenes"])} {scene["id"]}',flush=True)
concat=work/'concat.txt';concat.write_text(''.join(f"file '{x}'\n" for x in segments))
meta=work/'chapters.txt';meta.write_text(';FFMETADATA1\n'+''.join(f'[CHAPTER]\nTIMEBASE=1/1000\nSTART={round(start*1000)}\nEND={round(end*1000)}\ntitle={title}\n' for start,end,title in chapters))
final=out/f'{a.provider}-guided-walkthrough.mp4';run(['ffmpeg','-y','-v','error','-f','concat','-safe','0','-i',str(concat),'-i',str(meta),'-map_metadata','1','-c','copy','-movflags','+faststart',str(final)])
(out/f'{a.provider}-captions.srt').write_text('\n\n'.join(f'{i+1}\n{stamp(start,True)} --> {stamp(end,True)}\n{text}' for i,(start,end,text) in enumerate(cues))+'\n')
(out/f'{a.provider}-captions.vtt').write_text('WEBVTT\n\n'+'\n\n'.join(f'{stamp(start)} --> {stamp(end)}\n{text}' for start,end,text in cues)+'\n')
(out/f'{a.provider}-chapters.md').write_text('\n'.join(f'- {stamp(start)} — {title}' for start,_,title in chapters)+'\n')
(out/f'{a.provider}-render.json').write_text(json.dumps({'video':str(final),'seconds':cursor,'chapters':chapters,'cues':cues,'omitted':data.get('omitted',[])},indent=2)+'\n')
print(final,flush=True)

print('WALKTHROUGH_QA_META '+json.dumps({'provider':a.provider,'duration':duration(final),'scenes':[{'id':s['id'],'title':s['title'],'observed':s.get('observed')} for s in data['scenes']],'omitted':data.get('omitted',[])}),flush=True)
for wanted in ['digest','counts','tests','settings']:
 for index,scene in enumerate(data['scenes']):
  if scene['id']!=wanted:continue
  start,end,_=chapters[index];at=min(end-.3,start+4)
  png=work/f'qa-{wanted}.png'
  run(['ffmpeg','-y','-v','error','-ss',f'{at:.6f}','-i',str(final),'-frames:v','1',str(png)])
  print('WALKTHROUGH_QA_IMAGE '+json.dumps({'provider':a.provider,'scene':wanted,'png':base64.b64encode(png.read_bytes()).decode()}),flush=True)
