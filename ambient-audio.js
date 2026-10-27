/* Seasonal synthesized noise, inspired by WordLink's MIT SoundScapeEngine.
   Created only after a user gesture. No microphone, files or network required. */
window.GREAmbientAudio = (() => {
  let context, gain, filter, source;
  const settings = {spring:[1000,.32],summer:[2200,.24],autumn:[650,.38],winter:[280,.45]};
  function start(season, volume) {
    const Audio = window.AudioContext || window.webkitAudioContext;
    if (!Audio) return false;
    if (!context) {
      context = new Audio();
      const buffer = context.createBuffer(1,context.sampleRate*4,context.sampleRate);
      const samples = buffer.getChannelData(0); let brown=0;
      for(let i=0;i<samples.length;i++){brown=(brown+Math.random()*.04-.02)/1.02;samples[i]=brown*3;}
      source=context.createBufferSource();source.buffer=buffer;source.loop=true;
      filter=context.createBiquadFilter();filter.type="lowpass";
      gain=context.createGain();gain.gain.value=0;
      source.connect(filter).connect(gain).connect(context.destination);source.start();
    }
    context.resume();set(season,volume);return true;
  }
  function set(season,volume){
    if(!context)return;
    const [frequency,scale]=settings[season]||settings.autumn;
    filter.frequency.setTargetAtTime(frequency,context.currentTime,.4);
    gain.gain.setTargetAtTime(Math.max(0,Math.min(1,volume))*scale,context.currentTime,.2);
  }
  function stop(){if(gain)gain.gain.setTargetAtTime(0,context.currentTime,.12);}
  return {start,set,stop};
})();
