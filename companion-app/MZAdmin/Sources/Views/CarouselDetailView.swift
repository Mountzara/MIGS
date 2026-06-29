import SwiftUI

/// One decoded carousel slide (R2 keys carousel-assets/<slug>/slide_01.png …).
private struct SlideImage: Identifiable { let id: Int; let data: Data }

struct CarouselDetailView: View {
    let carousel: Carousel
    let model: CarouselsModel
    @Environment(\.dismiss) private var dismiss

    @State private var memo = ""
    @State private var showApproveSheet = false
    @State private var showRejectSheet = false
    @State private var coverImage: Data?
    @State private var slides: [SlideImage] = []
    @State private var loadingSlides = true
    @State private var assetError: String?
    @State private var full: Carousel?
    @State private var showEdit = false

    private var current: Carousel { full ?? carousel }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 16) {
                header
                if !slides.isEmpty {
                    slidesCard
                } else if loadingSlides && (carousel.slideCount ?? 0) > 0 {
                    slidesLoadingCard
                } else if let data = coverImage {
                    coverCard(data)
                }
                copyCard
                metadataCard
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Carousel")
        .toolbar {
            ToolbarItem(placement: .primaryAction) {
                Button { showEdit = true } label: { Image(systemName: "pencil") }
                    .help("Edit captions, hashtags & alt text")
            }
        }
        .overlay(alignment: .bottom) { ErrorBar(text: model.error ?? assetError) }
        .sheet(isPresented: $showApproveSheet) { decisionSheet(approve: true) }
        .sheet(isPresented: $showRejectSheet) { decisionSheet(approve: false) }
        .sheet(isPresented: $showEdit) {
            CarouselEditView(carousel: current, model: model) { updated in full = updated }
        }
        .task { await loadSlides() }
        .task { full = try? await model.api.carousel(slug: carousel.slug) }
    }

    /// Captions, hashtags, and per-slide alt text from the manifest.
    @ViewBuilder
    private var copyCard: some View {
        let c = current
        if c.captions != nil || c.hashtags != nil || (c.altText?.isEmpty == false) {
            VStack(alignment: .leading, spacing: 10) {
                Label("Copy", systemImage: "text.bubble").font(.subheadline.weight(.semibold))
                captionBlock("LinkedIn caption", c.captions?.linkedin, c.hashtags?.linkedin?.joined(separator: " "))
                captionBlock("Instagram caption", c.captions?.instagram, c.hashtags?.instagram?.joined(separator: " "))
                if let alt = c.altText, !alt.isEmpty {
                    Divider().padding(.vertical, 2)
                    Text("Alt text").font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                    ForEach(alt.sorted { (Int($0.key) ?? 0) < (Int($1.key) ?? 0) }, id: \.key) { k, v in
                        HStack(alignment: .top, spacing: 6) {
                            Text("#\((Int(k) ?? 0) + 1)").font(.caption2.monospaced()).foregroundStyle(.tertiary)
                            Text(v).font(.caption).fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading).padding(14).glassCard()
        }
    }

    @ViewBuilder
    private func captionBlock(_ title: String, _ caption: String?, _ tags: String?) -> some View {
        if let caption, !caption.isEmpty {
            VStack(alignment: .leading, spacing: 3) {
                Text(title).font(.caption.weight(.semibold)).foregroundStyle(.secondary)
                Text(caption).font(.caption).textSelection(.enabled).fixedSize(horizontal: false, vertical: true)
                if let tags, !tags.isEmpty {
                    Text(tags).font(.caption2).foregroundStyle(Theme.accentSoft).fixedSize(horizontal: false, vertical: true)
                }
            }
        }
    }

    /// Load every slide (slide_01.png … slide_NN.png) for the gallery; fall
    /// back to the single cover image if there are no slides.
    private func loadSlides() async {
        let n = carousel.slideCount ?? 0
        guard n > 0 else { loadingSlides = false; await loadCover(); return }
        var out: [SlideImage] = []
        var firstError: String?
        for i in 1...n {
            let file = "slide_\(String(format: "%02d", i)).png"
            do {
                out.append(SlideImage(id: i, data: try await model.api.carouselAsset(slug: carousel.slug, file: file)))
            } catch {
                if firstError == nil {
                    firstError = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
                }
            }
        }
        slides = out
        loadingSlides = false
        if out.isEmpty {
            await loadCover()
            if coverImage == nil { assetError = firstError ?? "Couldn't load this carousel's images." }
        }
    }

    private func loadCover() async {
        // cover_png_url is typically "/api/v1/admin/carousels/<slug>/asset/cover.png".
        // Derive the file name from the URL; default to "cover.png" if not set.
        let file: String
        if let url = carousel.coverPngUrl, let last = url.split(separator: "/").last {
            file = String(last)
        } else {
            file = "cover.png"
        }
        coverImage = try? await model.api.carouselAsset(slug: carousel.slug, file: file)
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack {
                statusBadge
                Spacer()
                if let n = carousel.slideCount {
                    Text("\(n) slides").font(.caption).foregroundStyle(.secondary)
                }
            }
            Text(carousel.title ?? carousel.slug).font(.headline)
            if let handle = carousel.handleLine, !handle.isEmpty {
                Text(handle).font(.caption).foregroundStyle(.secondary)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var statusBadge: some View {
        let (text, color): (String, Color) = {
            switch carousel.status {
            case "approved": return ("APPROVED", Theme.green)
            case "published": return ("PUBLISHED", Theme.accentSoft)
            case "rejected": return ("REJECTED", Theme.red)
            default: return ("DRAFT", Theme.amber)
            }
        }()
        return Text(text).font(.caption2.bold())
            .padding(.horizontal, 8).padding(.vertical, 3)
            .background(color.opacity(0.22), in: Capsule())
            .foregroundStyle(color)
    }

    @ViewBuilder
    private func coverCard(_ data: Data) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Cover", systemImage: "photo")
                .font(.subheadline.weight(.semibold))
            #if os(iOS)
            if let ui = UIImage(data: data) {
                Image(uiImage: ui).resizable().scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            #elseif os(macOS)
            if let ns = NSImage(data: data) {
                Image(nsImage: ns).resizable().scaledToFit()
                    .clipShape(RoundedRectangle(cornerRadius: 8))
            }
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var slidesCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Slides (\(carousel.slideCount ?? slides.count))", systemImage: "rectangle.stack")
                .font(.subheadline.weight(.semibold))
            #if os(iOS)
            TabView {
                ForEach(slides) { s in
                    slideImage(s.data).padding(.bottom, 30).tag(s.id)
                }
            }
            .tabViewStyle(.page(indexDisplayMode: .always))
            .indexViewStyle(.page(backgroundDisplayMode: .always))
            .frame(height: 420)
            #else
            VStack(spacing: 12) {
                ForEach(slides) { s in slideImage(s.data) }
            }
            #endif
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private var slidesLoadingCard: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Slides", systemImage: "rectangle.stack")
                .font(.subheadline.weight(.semibold))
            ProgressView().frame(maxWidth: .infinity).padding(.vertical, 24)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    @ViewBuilder
    private func slideImage(_ data: Data) -> some View {
        #if os(iOS)
        if let ui = UIImage(data: data) {
            Image(uiImage: ui).resizable().scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        #elseif os(macOS)
        if let ns = NSImage(data: data) {
            Image(nsImage: ns).resizable().scaledToFit()
                .clipShape(RoundedRectangle(cornerRadius: 8))
        }
        #endif
    }

    private var metadataCard: some View {
        VStack(alignment: .leading, spacing: 6) {
            Label("Details", systemImage: "info.circle")
                .font(.subheadline.weight(.semibold))
            if let t = carousel.postTopic, !t.isEmpty { kvRow("Topic", t) }
            if let w = carousel.weekLabel, !w.isEmpty { kvRow("Week", w) }
            kvRow("Slug", carousel.slug)
            if let c = carousel.createdAt { kvRow("Created", fmtEpoch(c)) }
            kvRow("Gate", carousel.readyToPublish == true ? "PASS" : "BLOCKED",
                  accent: carousel.readyToPublish == true ? Theme.green : Theme.red)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .padding(14).glassCard()
    }

    private func kvRow(_ label: String, _ value: String, accent: Color? = nil) -> some View {
        HStack(alignment: .top) {
            Text(label).font(.caption).foregroundStyle(.secondary)
                .frame(width: 88, alignment: .leading)
            Text(value).font(.subheadline).foregroundStyle(accent ?? .primary)
            Spacer()
        }
    }

    @ViewBuilder
    private var actionsBar: some View {
        if carousel.isDraft {
            HStack(spacing: 12) {
                Button(role: .destructive) {
                    memo = ""; showRejectSheet = true
                } label: { Text("Reject").frame(maxWidth: .infinity) }
                .buttonStyle(.bordered)
                Button {
                    memo = ""; showApproveSheet = true
                } label: { Text("Approve").bold().frame(maxWidth: .infinity) }
                .buttonStyle(.borderedProminent)
                .tint(Theme.accent)
                .disabled(carousel.readyToPublish != true)
            }
            .disabled(model.busyIDs.contains(carousel.slug))
            if carousel.readyToPublish != true {
                Text("Blocked by §3.11.6 deploy gate — backend will refuse approval until the violations are fixed upstream.")
                    .font(.caption2).foregroundStyle(.tertiary)
            }
        }
    }

    private func decisionSheet(approve: Bool) -> some View {
        NavigationStack {
            Form {
                Section("Admin memo (optional)") {
                    TextField(approve ? "Approval note for the audit trail"
                                      : "Why this carousel was rejected",
                              text: $memo, axis: .vertical)
                        .lineLimit(3...6)
                }
            }
            .navigationTitle(approve ? "Approve" : "Reject")
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button("Cancel") {
                        if approve { showApproveSheet = false } else { showRejectSheet = false }
                    }
                }
                ToolbarItem(placement: .confirmationAction) {
                    Button(approve ? "Approve" : "Reject", role: approve ? nil : .destructive) {
                        Task {
                            let m = memo.trimmingCharacters(in: .whitespacesAndNewlines)
                            let ok: Bool = approve
                                ? await model.approve(carousel.slug, memo: m.isEmpty ? nil : m)
                                : await model.reject(carousel.slug, memo: m.isEmpty ? nil : m)
                            if ok {
                                if approve { showApproveSheet = false } else { showRejectSheet = false }
                                dismiss()
                            }
                        }
                    }
                }
            }
        }
    }
}

// MARK: - Copy editor

/// Editor for a carousel's copy: per-platform captions + hashtags and the
/// per-slide alt text. Saves via PUT /api/v1/admin/carousels/<slug>.
struct CarouselEditView: View {
    let carousel: Carousel
    @ObservedObject var model: CarouselsModel
    var onSaved: (Carousel) -> Void
    @Environment(\.dismiss) private var dismiss

    @State private var liCaption: String
    @State private var igCaption: String
    @State private var liTags: String
    @State private var igTags: String
    @State private var altKeys: [String]
    @State private var altValues: [String: String]
    @State private var saving = false
    @State private var error: String?

    init(carousel: Carousel, model: CarouselsModel, onSaved: @escaping (Carousel) -> Void) {
        self.carousel = carousel
        self.model = model
        self.onSaved = onSaved
        _liCaption = State(initialValue: carousel.captions?.linkedin ?? "")
        _igCaption = State(initialValue: carousel.captions?.instagram ?? "")
        _liTags = State(initialValue: (carousel.hashtags?.linkedin ?? []).joined(separator: " "))
        _igTags = State(initialValue: (carousel.hashtags?.instagram ?? []).joined(separator: " "))
        let alt = carousel.altText ?? [:]
        _altKeys = State(initialValue: alt.keys.sorted { (Int($0) ?? 0) < (Int($1) ?? 0) })
        _altValues = State(initialValue: alt)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section("LinkedIn") {
                    TextField("Caption", text: $liCaption, axis: .vertical).lineLimit(3...10)
                    TextField("Hashtags", text: $liTags, axis: .vertical).lineLimit(1...4)
                }
                Section("Instagram") {
                    TextField("Caption", text: $igCaption, axis: .vertical).lineLimit(3...10)
                    TextField("Hashtags", text: $igTags, axis: .vertical).lineLimit(1...4)
                }
                if !altKeys.isEmpty {
                    Section("Alt text — per slide") {
                        ForEach(altKeys, id: \.self) { k in
                            VStack(alignment: .leading, spacing: 2) {
                                Text("Slide \((Int(k) ?? 0) + 1)").font(.caption).foregroundStyle(.secondary)
                                TextField("Alt text", text: Binding(
                                    get: { altValues[k] ?? "" },
                                    set: { altValues[k] = $0 }
                                ), axis: .vertical).lineLimit(1...4)
                            }
                        }
                    }
                }
            }
            .navigationTitle("Edit copy")
            #if os(iOS)
            .navigationBarTitleDisplayMode(.inline)
            #endif
            .overlay(alignment: .bottom) { ErrorBar(text: error) }
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button("Cancel") { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if saving { ProgressView() } else { Button("Save") { Task { await save() } } }
                }
            }
        }
        #if os(macOS)
        .frame(minWidth: 560, minHeight: 600)
        #endif
    }

    private func save() async {
        saving = true
        defer { saving = false }
        error = nil
        func t(_ s: String) -> String { s.trimmingCharacters(in: .whitespacesAndNewlines) }
        // Hashtags persist as arrays of "#tag" strings (the manifest's shape).
        func tags(_ s: String) -> [String] {
            s.split(whereSeparator: { $0 == " " || $0 == "\n" || $0 == "," })
                .map { $0.hasPrefix("#") ? String($0) : "#\($0)" }
        }
        let fields: [String: Any] = [
            "captions": ["linkedin": t(liCaption), "instagram": t(igCaption)],
            "hashtags": ["linkedin": tags(liTags), "instagram": tags(igTags)],
            "alt_text": altValues,
        ]
        do {
            let updated = try await model.api.updateCarousel(slug: carousel.slug, fields: fields)
            if let updated { onSaved(updated) }
            dismiss()
        } catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
        }
    }
}
