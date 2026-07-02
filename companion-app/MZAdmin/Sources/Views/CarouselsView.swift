import SwiftUI

@MainActor
final class CarouselsModel: ObservableObject {
    @Published var carousels: [Carousel] = []
    @Published var isLoading = false
    @Published var error: String?
    @Published var busyIDs: Set<String> = []

    let auth: AuthStore
    init(auth: AuthStore) { self.auth = auth }
    var api: AdminAPI { AdminAPI(token: auth.basicToken) }

    var drafts: [Carousel] { carousels.filter(\.isDraft) }
    var approved: [Carousel] { carousels.filter(\.isApproved) }
    var published: [Carousel] { carousels.filter(\.isPublished) }
    var rejected: [Carousel] { carousels.filter(\.isRejected) }

    func reload() async {
        isLoading = true; error = nil
        do { carousels = try await api.listCarousels() }
        catch {
            self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription
            if case AdminAPI.APIError.unauthorized = error { auth.signOut() }
        }
        isLoading = false
    }

    func approve(_ slug: String, memo: String?) async -> Bool {
        await run(slug) { try await self.api.setCarouselDecision(slug: slug, action: "approve", memo: memo) }
    }
    func reject(_ slug: String, memo: String?) async -> Bool {
        await run(slug) { try await self.api.setCarouselDecision(slug: slug, action: "reject", memo: memo) }
    }
    /// Permanent delete (manifest + all R2 assets + index entry).
    func delete(_ slug: String) async -> Bool {
        await run(slug) { try await self.api.deleteCarousel(slug: slug) }
    }
    private func run(_ id: String, _ op: @escaping () async throws -> Void) async -> Bool {
        busyIDs.insert(id); defer { busyIDs.remove(id) }
        do { try await op(); await reload(); return true }
        catch { self.error = (error as? AdminAPI.APIError)?.errorDescription ?? error.localizedDescription; return false }
    }
}

struct CarouselsView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: CarouselsModel
    @State private var selected: Carousel?

    init(auth: AuthStore) { _model = StateObject(wrappedValue: CarouselsModel(auth: auth)) }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.carousels.isEmpty {
                    ProgressView("Loading carousels…")
                } else if model.carousels.isEmpty {
                    ContentUnavailableView("Nothing queued",
                        systemImage: "rectangle.stack",
                        description: Text("Carousel drafts will appear here."))
                } else {
                    List {
                        section("Drafts", model.drafts, badge: model.drafts.count)
                        section("Approved", model.approved)
                        section("Published", model.published)
                        section("Rejected", model.rejected)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle("Carousels")
            .toolbar {
                ToolbarItem(placement: .primaryAction) {
                    Button { Task { await model.reload() } } label: { Image(systemName: "arrow.clockwise") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { ErrorBar(text: model.error) }
            .navigationDestination(item: $selected) { c in
                CarouselDetailView(carousel: c, model: model)
            }
        }
        .task { await model.reload() }
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [Carousel], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { c in
                    Button { selected = c } label: { CarouselRowView(carousel: c) }
                        .buttonStyle(.plain)
                }
            } header: {
                HStack {
                    Text(title)
                    if let badge, badge > 0 {
                        Text("\(badge)").font(.caption2.bold())
                            .padding(.horizontal, 7).padding(.vertical, 2)
                            .background(Theme.amber.opacity(0.22), in: Capsule())
                            .foregroundStyle(Theme.amber)
                    }
                }
            }
        }
    }
}

private struct CarouselRowView: View {
    let carousel: Carousel
    private var dotColor: Color {
        switch carousel.status {
        case "approved": return Theme.green
        case "published": return Theme.accentSoft
        case "rejected": return Theme.red
        default: return Theme.amber
        }
    }
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(dotColor).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(carousel.title ?? carousel.slug).font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    if let topic = carousel.postTopic, !topic.isEmpty { Text(topic).lineLimit(1) }
                    if let week = carousel.weekLabel, !week.isEmpty { Text("· \(week)") }
                    if let n = carousel.slideCount { Text("· \(n) slides") }
                    if carousel.readyToPublish == false {
                        Text("BLOCKED").font(.caption2.bold()).foregroundStyle(Theme.red)
                    }
                }.font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4).contentShape(Rectangle())
    }
}
