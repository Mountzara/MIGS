import SwiftUI

struct PostListView: View {
    @EnvironmentObject var auth: AuthStore
    @StateObject private var model: AppModel
    @State private var selected: Post?
    @State private var composing = false

    init(auth: AuthStore) {
        _model = StateObject(wrappedValue: AppModel(auth: auth))
    }

    var body: some View {
        NavigationStack {
            Group {
                if model.isLoading && model.posts.isEmpty {
                    ProgressView("Loading…")
                } else {
                    List {
                        section("Pending review", model.drafts, badge: model.drafts.count)
                        section("Live", model.published)
                        section("Rejected", model.rejected)
                    }
                    #if os(macOS)
                    .listStyle(.inset)
                    #else
                    .listStyle(.insetGrouped)
                    #endif
                }
            }
            .navigationTitle(model.kind.title)
            .toolbar {
                ToolbarItem(placement: .principal) { kindPicker }
                ToolbarItemGroup(placement: .primaryAction) {
                    Button { composing = true } label: { Image(systemName: "square.and.pencil") }
                        .help("New post")
                    Menu {
                        Button("Refresh") { Task { await model.reload() } }
                        Button("Rebuild \(model.kind.title) index") {
                            Task { await model.rebuildIndex() }
                        }
                        Button("Sign out", role: .destructive) { auth.signOut() }
                        if let e = auth.email { Text(e) }
                    } label: { Image(systemName: "ellipsis.circle") }
                }
            }
            .refreshable { await model.reload() }
            .overlay(alignment: .bottom) { errorBar }
            .navigationDestination(item: $selected) { post in
                PostDetailView(post: post, model: model)
            }
            .sheet(isPresented: $composing) { PostComposeView(model: model) }
        }
        .task { await model.reload() }
        .onChange(of: model.kind) { _, _ in Task { await model.reload() } }
    }

    private var kindPicker: some View {
        Picker("Kind", selection: $model.kind) {
            ForEach(PostKind.allCases) { Text($0.title).tag($0) }
        }
        .pickerStyle(.segmented)
        .frame(maxWidth: 280)
    }

    @ViewBuilder
    private func section(_ title: String, _ items: [Post], badge: Int? = nil) -> some View {
        if !items.isEmpty {
            Section {
                ForEach(items) { post in
                    Button { selected = post } label: { PostRow(post: post) }
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

    @ViewBuilder
    private var errorBar: some View {
        if let msg = model.errorMessage {
            Text(msg).font(.footnote).foregroundStyle(.white)
                .padding(10).background(Theme.red.opacity(0.9), in: Capsule())
                .padding(.bottom, 8)
                .transition(.move(edge: .bottom).combined(with: .opacity))
        }
    }
}

struct PostRow: View {
    let post: Post
    var body: some View {
        HStack(spacing: 12) {
            Circle().fill(Theme.statusColor(post.statusKind)).frame(width: 9, height: 9)
            VStack(alignment: .leading, spacing: 3) {
                Text(post.displayTitle).font(.body.weight(.medium)).lineLimit(2)
                HStack(spacing: 8) {
                    if let w = post.weekLabel { Text(w) }
                    Text(post.statusKind.label)
                    if let p = post.pmidsCited, !p.isEmpty { Text("\(p.count) refs") }
                }
                .font(.caption).foregroundStyle(.secondary)
            }
            Spacer()
            Image(systemName: "chevron.right").font(.caption).foregroundStyle(.tertiary)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }
}
