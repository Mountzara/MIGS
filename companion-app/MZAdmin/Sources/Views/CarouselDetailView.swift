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
                metadataCard
                actionsBar
            }
            .padding(16)
        }
        .navigationTitle("Carousel")
        .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
        .sheet(isPresented: $showApproveSheet) { decisionSheet(approve: true) }
        .sheet(isPresented: $showRejectSheet) { decisionSheet(approve: false) }
        .task { await loadSlides() }
    }

    /// Load every slide (slide_01.png … slide_NN.png) for the gallery; fall
    /// back to the single cover image if there are no slides.
    private func loadSlides() async {
        let n = carousel.slideCount ?? 0
        guard n > 0 else { loadingSlides = false; await loadCover(); return }
        var out: [SlideImage] = []
        for i in 1...n {
            let file = "slide_\(String(format: "%02d", i)).png"
            if let data = try? await model.api.carouselAsset(slug: carousel.slug, file: file) {
                out.append(SlideImage(id: i, data: data))
            }
        }
        slides = out
        loadingSlides = false
        if out.isEmpty { await loadCover() }
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
