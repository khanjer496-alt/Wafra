import React, {useEffect, useState} from 'react';
// Remotion is installed by this tool's isolated package, not the Expo app install.
// eslint-disable-next-line import/no-unresolved
import {AbsoluteFill, Composition, OffthreadVideo, cancelRender, continueRender, delayRender, registerRoot, staticFile, useCurrentFrame} from 'remotion';
import defaultTimeline from './capture-automation.json';

function Guide({language, data}) {
  const frame = useCurrentFrame();
  const [ready] = useState(() => delayRender('Load local fonts'));
  useEffect(() => {
    Promise.all([['Geist','Geist-Regular.ttf','400'],['Geist','Geist-SemiBold.ttf','600'],
      ['PlexArabic','IBMPlexSansArabic-Regular.ttf','400'],['PlexArabic','IBMPlexSansArabic-SemiBold.ttf','600']]
      .map(async ([family,file,weight]) => { const face=await new FontFace(family,`url("${staticFile(file)}")`,{weight}).load();document.fonts.add(face); }))
      .then(() => continueRender(ready)).catch(cancelRender);
  }, [ready]);
  const chapterIndex=data.chapters.findIndex(chapter => frame>=chapter.startFrame && frame<chapter.startFrame+chapter.durationFrames);
  const chapter=data.chapters[Math.max(0,chapterIndex)];
  const copy=chapter[language]; const ar=language==='ar';
  const direction=ar?'rtl':'ltr';
  return <AbsoluteFill style={{background:'#F6F2E8',color:'#272E29',fontFamily:ar?'PlexArabic, sans-serif':'Geist, sans-serif'}}>
    <div style={{position:'absolute',left:40,right:40,top:24,direction,fontSize:34,lineHeight:1.2,fontWeight:600}}>{data.headings[language].title}</div>
    <div style={{position:'absolute',left:40,right:40,top:72,direction,fontSize:21,lineHeight:1.2,color:'#596157'}}>{data.headings[language].recordingLabel}</div>
    <OffthreadVideo src={staticFile('recording-clean.mp4')} muted style={{position:'absolute',left:48,top:114,width:624,height:1358,objectFit:'contain'}} />
    <div style={{position:'absolute',left:40,right:40,top:1494,bottom:26,direction}}>
      <div style={{fontSize:20,lineHeight:1.2,color:'#3A684E',fontWeight:600,marginBottom:8}}>{ar?`الخطوة ${chapterIndex+1} من ${data.chapters.length}`:`STEP ${chapterIndex+1} OF ${data.chapters.length}`}</div>
      <div style={{fontSize:30,lineHeight:1.2,fontWeight:600,marginBottom:12}}>{copy.title}</div>
      <div style={{fontSize:26,lineHeight:1.4}}>{copy.body}</div>
    </div>
  </AbsoluteFill>;
}
function Root() {
  return <Composition id="recorded-guide" component={Guide} fps={24} width={720} height={1740}
    durationInFrames={defaultTimeline.durationInFrames}
    defaultProps={{ language: 'en', data: defaultTimeline }}
    calculateMetadata={({props}) => ({ durationInFrames: props.data.durationInFrames,
      fps: props.data.fps, width: props.data.width, height: props.data.height })} />;
}
registerRoot(Root);
