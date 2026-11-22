// Hold-to-record for shadowing (Task 6b).
export class Recorder {
  private rec: MediaRecorder | null = null;
  private chunks: Blob[] = [];
  private startedAt = 0;
  private stream: MediaStream | null = null;

  async start(): Promise<void> {
    this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } });
    this.chunks = [];
    this.rec = new MediaRecorder(this.stream, { mimeType: "audio/webm" });
    this.rec.ondataavailable = (e) => e.data.size && this.chunks.push(e.data);
    this.rec.start();
    this.startedAt = performance.now();
  }

  get recording(): boolean {
    return this.rec?.state === "recording";
  }

  async stop(): Promise<{ audioBase64: string; durationSec: number }> {
    const rec = this.rec;
    if (!rec) return { audioBase64: "", durationSec: 0 };
    const durationSec = (performance.now() - this.startedAt) / 1000;
    await new Promise<void>((resolve) => {
      rec.onstop = () => resolve();
      rec.stop();
    });
    this.stream?.getTracks().forEach((t) => t.stop());
    this.rec = null;
    const buf = new Uint8Array(await new Blob(this.chunks, { type: "audio/webm" }).arrayBuffer());
    let s = "";
    for (let i = 0; i < buf.length; i += 0x8000) s += String.fromCharCode(...buf.subarray(i, i + 0x8000));
    return { audioBase64: btoa(s), durationSec };
  }
}
