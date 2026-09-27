import SwiftUI
import AVFoundation
#if os(iOS)
import MediaPlayer
#endif

// =============================================================================
// Listen — e-reader for published briefs (port of ABOGVoicePrep's Narrator/
// VoiceCatalog stack, hardened for driving):
//   • Voice selection by QUALITY TIER (premium > enhanced > compact), never by
//     identifier substring — "siri_*_compact" is Siri-branded AND robotic.
//   • .playback + .spokenAudio session — audible with the mute switch on,
//     ducks music, routes to CarPlay/AirPods. No active session = silent TTS.
//   • UIBackgroundModes=audio comes from Info-iOS.plist (INFOPLIST_KEY_ can't
//     express array keys — silently ignored; gate on the BUILT plist).
//   • Beyond ABOG: lock-screen/CarPlay remote commands, now-playing info,
//     speed control (persisted), and call-interruption auto-resume.
// =============================================================================

// MARK: - HTML → spoken paragraphs

enum SpokenText {
    /// Strip a post's body_html into clean spoken paragraphs.
    static func paragraphs(fromHTML html: String) -> [String] {
        var s = html
        // Drop non-content blocks wholesale.
        for tag in ["script", "style", "head", "nav", "figure"] {
            s = s.replacingOccurrences(
                of: "<\(tag)[^>]*>[\\s\\S]*?</\(tag)>", with: " ",
                options: [.regularExpression, .caseInsensitive])
        }
        // Headings become their own sentence-terminated paragraphs so they
        // read as lead-ins (ABOG MarkdownProse lesson).
        s = s.replacingOccurrences(
            of: "<h[1-6][^>]*>([\\s\\S]*?)</h[1-6]>", with: "\n$1.\n",
            options: [.regularExpression, .caseInsensitive])
        // Block boundaries → paragraph breaks.
        s = s.replacingOccurrences(
            of: "</(p|div|li|ul|ol|tr|table|blockquote|section|article)>|<br\\s*/?>",
            with: "\n", options: [.regularExpression, .caseInsensitive])
        // Everything else tagged is inline — remove the tags, keep the text.
        s = s.replacingOccurrences(of: "<[^>]+>", with: " ", options: .regularExpression)
        s = decodeEntities(s)

        var out: [String] = []
        for raw in s.components(separatedBy: "\n") {
            let p = raw.replacingOccurrences(of: "\\s+", with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard p.count > 1 else { continue }
            // Skip-granularity guard: chop very long paragraphs at sentence
            // boundaries (~400 chars) so "skip" stays useful in the car.
            if p.count > 500 {
                out.append(contentsOf: splitLong(p))
            } else {
                out.append(p)
            }
        }
        return out
    }

    private static func splitLong(_ p: String) -> [String] {
        var chunks: [String] = []
        var current = ""
        for sentence in p.components(separatedBy: ". ") {
            if current.count + sentence.count > 400, !current.isEmpty {
                chunks.append(current.hasSuffix(".") ? current : current + ".")
                current = sentence
            } else {
                current += current.isEmpty ? sentence : ". " + sentence
            }
        }
        if !current.isEmpty { chunks.append(current) }
        return chunks
    }

    static func decodeEntities(_ s: String) -> String {
        var t = s
        let map = ["&amp;": "&", "&lt;": "<", "&gt;": ">", "&quot;": "\"",
                   "&#39;": "'", "&apos;": "'", "&nbsp;": " ", "&ndash;": "–",
                   "&mdash;": "—", "&middot;": "·", "&hellip;": "…",
                   "&rsquo;": "'", "&lsquo;": "'", "&rdquo;": "\u{201D}", "&ldquo;": "\u{201C}"]
        for (k, v) in map { t = t.replacingOccurrences(of: k, with: v) }
        // Numeric entities (&#8217; / &#x2019;)
        while let r = t.range(of: "&#x?[0-9a-fA-F]+;", options: .regularExpression) {
            let body = t[r].dropFirst(2).dropLast()
            let scalar: UInt32? = body.hasPrefix("x") || body.hasPrefix("X")
                ? UInt32(body.dropFirst(), radix: 16) : UInt32(body)
            if let scalar, let u = Unicode.Scalar(scalar) {
                t.replaceSubrange(r, with: String(Character(u)))
            } else {
                t.replaceSubrange(r, with: " ")
            }
        }
        return t
    }
}

// MARK: - Voice catalog (tier-scored selection)

@MainActor
final class ReaderVoiceCatalog: ObservableObject {
    static let shared = ReaderVoiceCatalog()

    struct Entry: Identifiable, Hashable {
        let id: String
        let name: String
        let language: String
        let qualityRank: Int      // premium 3, enhanced 2, compact 1
        let isFemale: Bool
        let isSiriIdentifier: Bool
        var isNatural: Bool { qualityRank >= 2 }
        var tierLabel: String { qualityRank == 3 ? "Premium" : qualityRank == 2 ? "Enhanced" : "Compact" }
        var accentLabel: String {
            if language.hasPrefix("en-GB") { return "UK" }
            if language.hasPrefix("en-US") { return "US" }
            if language.hasPrefix("en-AU") { return "AU" }
            if language.hasPrefix("en-IE") { return "IE" }
            if language.hasPrefix("en-ZA") { return "ZA" }
            if language.hasPrefix("en-IN") { return "IN" }
            return language
        }
        var displayName: String { "\(name) · \(accentLabel) · \(tierLabel)" }
        /// Persona name without tier suffixes, for matching compact↔enhanced pairs.
        var codename: String { name.components(separatedBy: " (").first ?? name }
    }

    @Published private(set) var installed: [Entry] = []
    @Published var rateScale: Double {
        didSet { UserDefaults.standard.set(rateScale, forKey: "listen.rateScale") }
    }

    private static let preferredKey = "listen.voiceId"
    var preferredIdentifier: String? {
        get { UserDefaults.standard.string(forKey: Self.preferredKey) }
        set {
            if let newValue { UserDefaults.standard.set(newValue, forKey: Self.preferredKey) }
            else { UserDefaults.standard.removeObject(forKey: Self.preferredKey) }
            objectWillChange.send()
        }
    }

    private init() {
        let saved = UserDefaults.standard.double(forKey: "listen.rateScale")
        rateScale = saved == 0 ? 0.95 : saved
        refresh()
    }

    /// Tier dominates in 1000s; Siri-family bonus only when natural; UK then
    /// female break ties. (Port of VoiceCatalog.score — the fix for both the
    /// "robotic siri_compact" and the "dead GB preference" defects.)
    private static func score(_ e: Entry) -> Int {
        (e.qualityRank * 1000)
            + (e.isSiriIdentifier && e.isNatural ? 200 : 0)
            + (e.language.hasPrefix("en-GB") ? 20 : 0)
            + (e.isFemale ? 1 : 0)
    }

    func refresh() {
        installed = AVSpeechSynthesisVoice.speechVoices()
            .filter { $0.language.hasPrefix("en") }
            .map { v in
                let rank: Int = v.quality == .premium ? 3 : v.quality == .enhanced ? 2 : 1
                return Entry(id: v.identifier, name: v.name, language: v.language,
                             qualityRank: rank,
                             isFemale: v.gender == .female,
                             isSiriIdentifier: v.identifier.lowercased().contains("siri"))
            }
            .sorted { Self.score($0) > Self.score($1) }
    }

    var selectable: [Entry] { installed.filter { $0.isNatural && $0.isSiriIdentifier } }
    var fallbackSelectable: [Entry] { installed.filter { $0.isNatural && !$0.isSiriIdentifier } }
    /// Siri personas present only at compact tier — shown as download hints,
    /// never selectable ("hidden" and "absent" must not look the same).
    var upgradeable: [Entry] {
        let haveNatural = Set(selectable.map(\.codename))
        return installed.filter { $0.isSiriIdentifier && !$0.isNatural && !haveNatural.contains($0.codename) }
    }

    private func resolveEntry() -> Entry? {
        if let pref = preferredIdentifier,
           let match = installed.first(where: { $0.id == pref }),
           match.isNatural {
            return match
        }
        return selectable.first ?? fallbackSelectable.first ?? installed.first
    }

    var resolved: Entry? { resolveEntry() }
    var isDegraded: Bool { !(resolveEntry()?.isNatural ?? false) }
    var hasUnusedNaturalVoice: Bool { isDegraded && installed.contains(where: \.isNatural) }

    func voice() -> AVSpeechSynthesisVoice? {
        if let e = resolveEntry(), let v = AVSpeechSynthesisVoice(identifier: e.id) { return v }
        return AVSpeechSynthesisVoice(language: "en-GB") ?? AVSpeechSynthesisVoice(language: "en-US")
    }

    /// Single prosody shaper — the rate constant lives HERE only.
    func configure(_ u: AVSpeechUtterance) {
        u.voice = voice()
        u.rate = AVSpeechUtteranceDefaultSpeechRate * Float(rateScale)
        u.pitchMultiplier = 1.0
        u.postUtteranceDelay = 0.25
    }

    /// The audiobook session: audible with the mute switch on, ducks music,
    /// routes to CarPlay/AirPods. No active session = silent TTS.
    static func activatePlaybackSession() {
        #if os(iOS)
        try? AVAudioSession.sharedInstance().setCategory(
            .playback, mode: .spokenAudio, options: [.duckOthers])
        try? AVAudioSession.sharedInstance().setActive(true)
        #endif
    }
}

// MARK: - Narrator (paragraph queue + brief playlist)

/// One brief queued for listening.
struct ListenItem: Identifiable {
    let id: String            // post id
    let title: String
    let kindLabel: String
    let paragraphs: [String]
}

@MainActor
final class BriefNarrator: NSObject, ObservableObject, AVSpeechSynthesizerDelegate {
    static let shared = BriefNarrator()

    @Published private(set) var isSpeaking = false
    @Published private(set) var isPaused = false
    @Published private(set) var itemIndex = 0
    @Published private(set) var paragraphIndex = 0
    @Published private(set) var items: [ListenItem] = []
    @Published private(set) var voiceLabel = ""

    /// Fires when the whole playlist finishes naturally (used to chain fetches).
    var onPlaylistFinished: (() -> Void)?

    private let synth = AVSpeechSynthesizer()
    private var interruptedByCall = false

    var currentItem: ListenItem? {
        items.indices.contains(itemIndex) ? items[itemIndex] : nil
    }
    var progressText: String {
        guard let item = currentItem else { return "" }
        return "\(paragraphIndex + 1)/\(item.paragraphs.count)"
    }

    private override init() {
        super.init()
        synth.delegate = self
        #if os(iOS)
        setUpRemoteCommands()
        NotificationCenter.default.addObserver(
            self, selector: #selector(handleInterruption),
            name: AVAudioSession.interruptionNotification,
            object: AVAudioSession.sharedInstance())
        #endif
    }

    // MARK: transport

    func play(_ playlist: [ListenItem], fromItem start: Int = 0) {
        stop()
        guard !playlist.isEmpty else { return }
        ReaderVoiceCatalog.activatePlaybackSession()
        items = playlist
        itemIndex = max(0, min(start, playlist.count - 1))
        paragraphIndex = 0
        isSpeaking = true
        isPaused = false
        speakCurrent()
    }

    /// Append more briefs to the tail of the running playlist (lazy prefetch).
    func append(_ more: [ListenItem]) {
        let known = Set(items.map(\.id))
        items += more.filter { !known.contains($0.id) }
    }

    func pause() {
        synth.pauseSpeaking(at: .word)
        isPaused = true
        updateNowPlaying()
    }

    func resume() {
        ReaderVoiceCatalog.activatePlaybackSession()
        synth.continueSpeaking()
        isPaused = false
        updateNowPlaying()
    }

    func togglePlayPause() { isPaused ? resume() : pause() }

    func skipForward() {
        guard let item = currentItem else { return }
        synth.stopSpeaking(at: .immediate)
        if paragraphIndex + 1 < item.paragraphs.count {
            paragraphIndex += 1
            speakCurrent()
        } else {
            advanceToNextItem()
        }
    }

    func skipBack() {
        synth.stopSpeaking(at: .immediate)
        paragraphIndex = max(0, paragraphIndex - 1)
        speakCurrent()
    }

    func nextBrief() {
        synth.stopSpeaking(at: .immediate)
        advanceToNextItem()
    }

    func previousBrief() {
        synth.stopSpeaking(at: .immediate)
        itemIndex = max(0, itemIndex - 1)
        paragraphIndex = 0
        speakCurrent()
    }

    func stop() {
        synth.stopSpeaking(at: .immediate)
        items = []
        itemIndex = 0
        paragraphIndex = 0
        isSpeaking = false
        isPaused = false
        clearNowPlaying()
    }

    // MARK: engine

    private func speakCurrent() {
        guard let item = currentItem, paragraphIndex < item.paragraphs.count else {
            finishPlaylist()
            return
        }
        isPaused = false
        let u = AVSpeechUtterance(string: item.paragraphs[paragraphIndex])
        ReaderVoiceCatalog.shared.configure(u)
        if let e = ReaderVoiceCatalog.shared.resolved { voiceLabel = e.displayName }
        synth.speak(u)
        updateNowPlaying()
    }

    private func advanceToNextItem() {
        if itemIndex + 1 < items.count {
            itemIndex += 1
            paragraphIndex = 0
            speakCurrent()
        } else {
            finishPlaylist()
        }
    }

    private func finishPlaylist() {
        let done = onPlaylistFinished
        stop()
        done?()
    }

    nonisolated func speechSynthesizer(_ s: AVSpeechSynthesizer, didFinish u: AVSpeechUtterance) {
        Task { @MainActor in
            guard isSpeaking, let item = currentItem else { return }
            if paragraphIndex + 1 < item.paragraphs.count {
                paragraphIndex += 1
                speakCurrent()
            } else {
                advanceToNextItem()
            }
        }
    }

    // MARK: interruptions (calls / Siri) — pause, then auto-resume

    @objc private nonisolated func handleInterruption(_ note: Notification) {
        #if os(iOS)
        guard let info = note.userInfo,
              let typeRaw = info[AVAudioSessionInterruptionTypeKey] as? UInt,
              let type = AVAudioSession.InterruptionType(rawValue: typeRaw) else { return }
        let optionsRaw = info[AVAudioSessionInterruptionOptionKey] as? UInt ?? 0
        let shouldResume = AVAudioSession.InterruptionOptions(rawValue: optionsRaw).contains(.shouldResume)
        Task { @MainActor in
            switch type {
            case .began:
                if isSpeaking, !isPaused {
                    pause()
                    interruptedByCall = true
                }
            case .ended:
                if interruptedByCall, shouldResume { resume() }
                interruptedByCall = false
            @unknown default: break
            }
        }
        #endif
    }

    // MARK: lock screen / CarPlay

    #if os(iOS)
    private func setUpRemoteCommands() {
        let c = MPRemoteCommandCenter.shared()
        c.playCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.resume() }; return .success
        }
        c.pauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.pause() }; return .success
        }
        c.togglePlayPauseCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.togglePlayPause() }; return .success
        }
        c.nextTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipForward() }; return .success
        }
        c.previousTrackCommand.addTarget { [weak self] _ in
            Task { @MainActor in self?.skipBack() }; return .success
        }
    }
    #endif

    private func updateNowPlaying() {
        #if os(iOS)
        guard let item = currentItem else { return }
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: item.title,
            MPMediaItemPropertyArtist: "Mount Zara — \(item.kindLabel)",
            MPNowPlayingInfoPropertyPlaybackRate: isPaused ? 0.0 : 1.0,
        ]
        // Paragraph-based progress so the lock screen shows movement.
        info[MPMediaItemPropertyPlaybackDuration] = Double(item.paragraphs.count)
        info[MPNowPlayingInfoPropertyElapsedPlaybackTime] = Double(paragraphIndex)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
        #endif
    }

    private func clearNowPlaying() {
        #if os(iOS)
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        #endif
    }
}

// MARK: - Listen model (published briefs of both kinds, lazy body fetch)

@MainActor
final class ListenModel: ObservableObject {
    @Published var briefs: [Post] = []          // published only, newest first
    @Published var isLoading = false
    @Published var error: String?
    @Published var loadingID: String?           // brief currently fetching its body

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    private var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    private let narrator = BriefNarrator.shared

    func reload() async {
        isLoading = true; error = nil
        do {
            // Both feeds in one pass; only published briefs are listenable.
            async let blogs = api.listPosts(kind: .blog)
            async let evidence = api.listPosts(kind: .evidence)
            let all = (try await blogs) + (try await evidence)
            briefs = all.filter(\.isPublished).sorted {
                ($0.publishedAt ?? $0.createdAt ?? "") > ($1.publishedAt ?? $1.createdAt ?? "")
            }
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    private func kindLabel(_ p: Post) -> String {
        PostKind(rawValue: p.kind)?.title ?? p.kind.capitalized
    }

    /// Build the spoken form of one brief (title lead-in + stripped body).
    private func listenItem(for post: Post) async -> ListenItem? {
        loadingID = post.id
        defer { loadingID = nil }
        let full = (try? await api.fetchPost(id: post.id)) ?? post
        var paras: [String] = ["\(full.displayTitle)."]
        if let body = full.bodyHTML, !body.isEmpty {
            paras += SpokenText.paragraphs(fromHTML: body)
        } else if let s = full.summary, !s.isEmpty {
            paras.append(s)
        }
        guard paras.count > 1 else { return nil }
        return ListenItem(id: full.id, title: full.displayTitle,
                          kindLabel: kindLabel(full), paragraphs: paras)
    }

    /// Play starting at this brief; the rest of the list queues up behind it
    /// (bodies fetched in the background while the first one speaks).
    func play(from post: Post) async {
        guard let first = await listenItem(for: post) else {
            error = "This brief has no readable content."
            return
        }
        narrator.onPlaylistFinished = nil
        narrator.play([first])
        let startIdx = briefs.firstIndex(where: { $0.id == post.id }) ?? 0
        let rest = Array(briefs.dropFirst(startIdx + 1))
        Task { [weak self] in
            guard let self else { return }
            for p in rest {
                if let item = await self.listenItem(for: p) {
                    self.narrator.append([item])
                }
            }
        }
    }

    func playAll() async {
        guard let first = briefs.first else { return }
        await play(from: first)
    }
}

// MARK: - Listen tab

struct ListenView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: ListenModel
    @ObservedObject private var narrator = BriefNarrator.shared
    @ObservedObject private var catalog = ReaderVoiceCatalog.shared
    @State private var showVoiceSettings = false
    @Environment(\.scenePhase) private var scenePhase

    init(auth: AuthStore) { _model = StateObject(wrappedValue: ListenModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.briefs.isEmpty {
                    ProgressView("Loading published briefs…")
                } else if model.briefs.isEmpty {
                    ContentUnavailableView("Nothing published yet", systemImage: "headphones",
                        description: Text("Published Evidence and Trend briefs appear here, ready to listen."))
                } else {
                    List {
                        if catalog.isDegraded { degradedRow }
                        ForEach(model.briefs) { post in briefRow(post) }
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Listen")
            .toolbar {
                ToolbarItemGroup(placement: .primaryAction) {
                    Button {
                        showVoiceSettings = true
                    } label: {
                        Image(systemName: catalog.isDegraded ? "waveform.slash" : "waveform")
                            .foregroundStyle(catalog.isDegraded ? Theme.amber : Theme.accentSoft)
                    }
                    .help("Voice settings")
                    Button { Task { await model.playAll() } } label: {
                        Image(systemName: "play.circle")
                    }
                    .disabled(model.briefs.isEmpty)
                    .help("Play all briefs, newest first")
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .safeAreaInset(edge: .bottom) {
                if narrator.isSpeaking { playerBar }
            }
            .sheet(isPresented: $showVoiceSettings) { VoiceSettingsSheet() }
        }
        .task { await model.reload() }
        .onChange(of: scenePhase) { _, phase in
            // A voice downloaded in Settings takes effect on return, no relaunch.
            if phase == .active { catalog.refresh() }
        }
    }

    private var degradedRow: some View {
        Button { showVoiceSettings = true } label: {
            Label {
                VStack(alignment: .leading, spacing: 2) {
                    Text("Using a robotic voice").font(.subheadline.weight(.semibold))
                    Text(catalog.hasUnusedNaturalVoice
                         ? "A natural voice is installed but not selected — tap to fix."
                         : "Download an Enhanced/Premium Siri voice for natural reading — tap for steps.")
                        .font(.caption).foregroundStyle(.secondary)
                }
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.amber)
            }
        }
        .buttonStyle(.plain)
    }

    private func briefRow(_ post: Post) -> some View {
        let isCurrent = narrator.currentItem?.id == post.id
        return Button { Task { await model.play(from: post) } } label: {
            HStack(spacing: 12) {
                Image(systemName: isCurrent
                      ? (narrator.isPaused ? "pause.circle.fill" : "speaker.wave.2.circle.fill")
                      : "play.circle")
                    .font(.title3)
                    .foregroundStyle(isCurrent ? Theme.accent : Theme.accentSoft)
                VStack(alignment: .leading, spacing: 3) {
                    Text(post.displayTitle).font(.body.weight(.medium)).lineLimit(2)
                    HStack(spacing: 8) {
                        Text(PostKind(rawValue: post.kind)?.title ?? post.kind)
                        if let w = post.weekLabel { Text("· \(w)") }
                        if model.loadingID == post.id { ProgressView().controlSize(.mini) }
                    }
                    .font(.caption).foregroundStyle(.secondary)
                }
                Spacer()
            }
            .padding(.vertical, 4).contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }

    // MARK: player bar

    private var playerBar: some View {
        VStack(spacing: 8) {
            HStack {
                VStack(alignment: .leading, spacing: 2) {
                    Text(narrator.currentItem?.title ?? "").font(.footnote.weight(.semibold)).lineLimit(1)
                    Text("\(narrator.progressText) · \(narrator.voiceLabel)")
                        .font(.caption2).foregroundStyle(.secondary).lineLimit(1)
                }
                Spacer()
                speedMenu
                Button { narrator.stop() } label: { Image(systemName: "xmark.circle.fill") }
                    .foregroundStyle(.secondary)
            }
            HStack(spacing: 26) {
                Button { narrator.previousBrief() } label: { Image(systemName: "backward.end.fill") }
                Button { narrator.skipBack() } label: { Image(systemName: "gobackward.15") }
                Button { narrator.togglePlayPause() } label: {
                    Image(systemName: narrator.isPaused ? "play.circle.fill" : "pause.circle.fill")
                        .font(.system(size: 40))
                }
                Button { narrator.skipForward() } label: { Image(systemName: "goforward.15") }
                Button { narrator.nextBrief() } label: { Image(systemName: "forward.end.fill") }
            }
            .font(.title3)
            .foregroundStyle(Theme.accentSoft)
        }
        .padding(12)
        .background(.ultraThinMaterial)
    }

    private var speedMenu: some View {
        Menu {
            ForEach([(0.8, "0.85×"), (0.95, "1× (normal)"), (1.05, "1.1×"), (1.15, "1.2×"), (1.3, "1.35×")], id: \.0) { scale, label in
                Button {
                    catalog.rateScale = scale
                } label: {
                    if abs(catalog.rateScale - scale) < 0.01 {
                        Label(label, systemImage: "checkmark")
                    } else {
                        Text(label)
                    }
                }
            }
        } label: {
            Image(systemName: "gauge.with.dots.needle.67percent")
        }
        .help("Reading speed (applies from the next paragraph)")
    }
}

// MARK: - Voice settings sheet (download prompting)

struct VoiceSettingsSheet: View {
    @ObservedObject private var catalog = ReaderVoiceCatalog.shared
    @Environment(\.dismiss) private var dismiss
    @Environment(\.scenePhase) private var scenePhase

    var body: some View {
        NavigationStack {
            Form {
                if catalog.isDegraded { degradedBanner }
                currentSection
                if !catalog.selectable.isEmpty {
                    voiceSection("Siri voices — Enhanced & Premium", catalog.selectable)
                }
                if !catalog.fallbackSelectable.isEmpty {
                    voiceSection("Other natural voices", catalog.fallbackSelectable)
                }
                if !catalog.upgradeable.isEmpty { upgradeSection }
                downloadHelp
            }
            .navigationTitle("Reading voice")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Done") { dismiss() } }
                ToolbarItem(placement: .primaryAction) {
                    Button { catalog.refresh() } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .onChange(of: scenePhase) { _, phase in
                if phase == .active { catalog.refresh() }
            }
        }
        #if os(macOS)
        .frame(minWidth: 460, minHeight: 520)
        #endif
    }

    private var degradedBanner: some View {
        Section {
            Label {
                Text(catalog.hasUnusedNaturalVoice
                     ? "A natural voice is installed but not selected."
                     : "No natural (Enhanced or Premium) English voice is downloaded on this device — reading will sound robotic until one is.")
            } icon: {
                Image(systemName: "exclamationmark.triangle.fill").foregroundStyle(Theme.amber)
            }
            .font(.callout)
        }
    }

    private var currentSection: some View {
        Section("Current voice") {
            VStack(alignment: .leading, spacing: 3) {
                Text(catalog.resolved?.displayName ?? "System default").font(.body.weight(.medium))
                Text(catalog.preferredIdentifier == nil
                     ? "Chosen automatically — best tier, then British, then female."
                     : "Chosen by you.")
                    .font(.caption).foregroundStyle(.secondary)
            }
            if catalog.preferredIdentifier != nil {
                Button("Use automatic instead") { catalog.preferredIdentifier = nil }
            }
        }
    }

    private func voiceSection(_ title: String, _ entries: [ReaderVoiceCatalog.Entry]) -> some View {
        Section(title) {
            ForEach(entries) { e in
                Button {
                    catalog.preferredIdentifier = e.id
                } label: {
                    HStack {
                        Text(e.displayName).foregroundStyle(.primary)
                        Spacer()
                        if catalog.resolved?.id == e.id {
                            Image(systemName: "checkmark").foregroundStyle(Theme.accent)
                        }
                    }
                }
            }
        }
    }

    private var upgradeSection: some View {
        Section("Siri voices on this device — Enhanced not downloaded") {
            ForEach(catalog.upgradeable) { e in
                Label {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(e.codename) · \(e.accentLabel)").foregroundStyle(.primary)
                        Text("Compact only — download Enhanced for \(e.accentLabel) to use this voice.")
                            .font(.caption).foregroundStyle(.secondary)
                    }
                } icon: {
                    Image(systemName: "arrow.down.circle").foregroundStyle(Theme.accentSoft)
                }
            }
        }
    }

    private var downloadHelp: some View {
        Section("How to download a natural voice") {
            Text("Settings → Accessibility → Spoken Content → Voices → English → pick a voice → download the **Enhanced** or **Premium** file. The plain download is the compact, robotic one. Return here afterward — the new voice is picked up automatically.")
                .font(.caption)
        }
    }
}
