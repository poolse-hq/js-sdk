/**
 * What a call carries.
 *
 * Fixed when the call is placed, and travelling with the ring rather
 * than the connection: CallKit shows a different answer button for a
 * video call and cannot be changed once the call is reported. Either
 * side can still turn their camera on or off mid-call — this is what
 * the call *opens* as.
 */
export type CallMedia = 'audio' | 'video';
