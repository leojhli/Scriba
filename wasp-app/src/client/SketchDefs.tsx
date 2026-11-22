// Two "pencil" filters: noise-displaced strokes so outlines wobble like they were drawn by hand.
// Outlines use one or the other (see study.css); text is never filtered, so it stays crisp.
export function SketchDefs() {
  return (
    <svg width="0" height="0" style={{ position: "absolute" }} aria-hidden="true" focusable="false">
      <filter id="sk1" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves={2} seed={3} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={3.5} xChannelSelector="R" yChannelSelector="G" />
      </filter>
      <filter id="sk2" x="-5%" y="-5%" width="110%" height="110%">
        <feTurbulence type="fractalNoise" baseFrequency="0.025" numOctaves={2} seed={11} result="noise" />
        <feDisplacementMap in="SourceGraphic" in2="noise" scale={5} xChannelSelector="G" yChannelSelector="R" />
      </filter>
    </svg>
  );
}
