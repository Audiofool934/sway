// The score variant's sampler (sway.scored): it plays Sway's score with the General MIDI
// sound bank that ships with macOS, one request at a time, until its input closes.
//
// Each request and answer is one line of JSON on stdin, and a block of audio on stdout:
//
// - The first line sets it up: {"sampleRate", "reverb", "tracks": [{"program", "volume"}]}.
//   Each track is one sampler with one General MIDI program.
// - Each later line asks for one render: {"frames", "keep", "notes": [[track, start s,
//   length s, pitch, velocity], ...]}. The sampler starts from silence, with no voice and
//   no reverb left from the request before, renders `frames` frames, and answers with the
//   frames from `keep` on. The first render after setup is the same, sample for sample,
//   as the comparison's offline sampler (work/renderers/sampler.swift) makes.
//
// An answer is a 4-byte little-endian frame count, then the left channel's float32
// samples, then the right's. The setup is answered with a count of 0.
//
// Build: swiftc -O sampler.swift -o sampler

import AVFoundation
import AudioToolbox
import Foundation

struct Setup: Decodable {
    struct Track: Decodable {
        let program: Int
        let volume: Float
    }

    let sampleRate: Double
    let reverb: Float
    let tracks: [Track]
}

struct Request: Decodable {
    let frames: Int
    let keep: Int
    let notes: [[Double]]
}

struct Event {
    let frame: Int
    let on: Bool
    let track: Int
    let pitch: UInt8
    let velocity: UInt8
}

let bank = URL(
    fileURLWithPath: "/System/Library/Components/CoreAudio.component/Contents/Resources/gs_instruments.dls"
)
let block: AVAudioFrameCount = 64  // Notes start and stop on these boundaries: 1.5 ms.
let settling = 4.0  // Seconds of silence between requests.

func fail(_ message: String) -> Never {
    FileHandle.standardError.write(Data("sampler: \(message)\n".utf8))
    exit(1)
}

func answer(_ left: [Float], _ right: [Float]) {
    var count = UInt32(left.count).littleEndian
    var data = Data(bytes: &count, count: 4)
    left.withUnsafeBufferPointer { data.append($0) }
    right.withUnsafeBufferPointer { data.append($0) }
    FileHandle.standardOutput.write(data)
}

guard let line = readLine(),
    let setup = try? JSONDecoder().decode(Setup.self, from: Data(line.utf8))
else { fail("the first line must set the sampler up") }

let engine = AVAudioEngine()
let format = AVAudioFormat(standardFormatWithSampleRate: setup.sampleRate, channels: 2)!
try engine.enableManualRenderingMode(.offline, format: format, maximumFrameCount: block)

func connect(_ source: AVAudioNode, to target: AVAudioNode) throws {
    if #available(macOS 27, *) {
        try engine.connectNode(source, to: target, format: format)
    } else {
        engine.connect(source, to: target, format: format)
    }
}

let reverb = AVAudioUnitReverb()
reverb.loadFactoryPreset(.largeHall)
reverb.wetDryMix = setup.reverb
engine.attach(reverb)
try connect(engine.mainMixerNode, to: reverb)
try connect(reverb, to: engine.outputNode)

var samplers: [AVAudioUnitSampler] = []
for track in setup.tracks {
    let sampler = AVAudioUnitSampler()
    engine.attach(sampler)
    try connect(sampler, to: engine.mainMixerNode)
    try sampler.loadSoundBankInstrument(
        at: bank, program: UInt8(track.program),
        bankMSB: UInt8(kAUSampler_DefaultMelodicBankMSB),
        bankLSB: UInt8(kAUSampler_DefaultBankLSB))
    sampler.volume = track.volume
    samplers.append(sampler)
}
try engine.start()
let buffer = AVAudioPCMBuffer(pcmFormat: engine.manualRenderingFormat, frameCapacity: block)!

// Silence every voice, and render until the reverb has died away, so that each request
// starts from silence. A reset of the engine leaves the reverb ringing, and a restart
// changes the sound: after one, the same score plays about 10 dB louder.
func settle() throws {
    for sampler in samplers {
        for pitch: UInt8 in 0...127 {
            sampler.stopNote(pitch, onChannel: 0)
        }
    }
    var left = Int(settling * setup.sampleRate)
    while left > 0 {
        let frames = AVAudioFrameCount(min(Int(block), left))
        guard try engine.renderOffline(frames, to: buffer) == .success else { fail("render failed") }
        left -= Int(frames)
    }
}

answer([], [])

while let line = readLine() {
    guard let request = try? JSONDecoder().decode(Request.self, from: Data(line.utf8)),
        request.keep >= 0, request.keep <= request.frames
    else { fail("unreadable request") }
    try settle()

    var events: [Event] = []
    for note in request.notes {
        guard note.count == 5, Int(note[0]) >= 0, Int(note[0]) < samplers.count else {
            fail("a note must be [track, start, length, pitch, velocity]")
        }
        let start = Int((note[1] * setup.sampleRate).rounded())
        let end = Int(((note[1] + note[2]) * setup.sampleRate).rounded())
        let pitch = UInt8(min(127, max(0, note[3])))
        let velocity = UInt8(min(127, max(1, note[4])))
        events.append(Event(frame: start, on: true, track: Int(note[0]), pitch: pitch, velocity: velocity))
        events.append(Event(frame: end, on: false, track: Int(note[0]), pitch: pitch, velocity: 0))
    }
    // At the same frame, notes stop before others start, so that a repeated pitch is struck again.
    events.sort { ($0.frame, $0.on ? 1 : 0) < ($1.frame, $1.on ? 1 : 0) }

    var left: [Float] = [], right: [Float] = []
    left.reserveCapacity(request.frames - request.keep)
    right.reserveCapacity(request.frames - request.keep)
    var done = 0
    var next = 0
    while done < request.frames {
        while next < events.count && events[next].frame <= done {
            let event = events[next]
            if event.on {
                samplers[event.track].startNote(event.pitch, withVelocity: event.velocity, onChannel: 0)
            } else {
                samplers[event.track].stopNote(event.pitch, onChannel: 0)
            }
            next += 1
        }
        let frames = min(Int(block), request.frames - done)
        let status = try engine.renderOffline(AVAudioFrameCount(frames), to: buffer)
        guard status == .success else { fail("render failed: \(status.rawValue)") }
        let from = max(0, request.keep - done)
        if from < frames {
            let channels = buffer.floatChannelData!
            left.append(contentsOf: UnsafeBufferPointer(start: channels[0] + from, count: frames - from))
            right.append(contentsOf: UnsafeBufferPointer(start: channels[1] + from, count: frames - from))
        }
        done += frames
    }
    answer(left, right)
}
