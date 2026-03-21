import AppKit
import Observation
import SwiftUI

@MainActor
struct CockpitWindow: View {
    @Bindable var store: CockpitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Arc")
                        .font(.largeTitle.weight(.semibold))
                    Text(self.store.snapshot?.storePath ?? "OpenClaw-powered operator workspace")
                        .font(.caption)
                        .foregroundStyle(.secondary)
                    if let projectRoot = self.store.projectRootLabel {
                        Text(projectRoot)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
                Spacer()
                if self.store.isLoading {
                    ProgressView()
                        .controlSize(.small)
                }
                Button {
                    Task { await self.store.startNextWorker() }
                } label: {
                    if self.store.isStartingNextWorker {
                        Label("Starting…", systemImage: "play.square.fill")
                    } else {
                        Label("Start Next Worker", systemImage: "play.square.fill")
                    }
                }
                .buttonStyle(.borderedProminent)
                .disabled(self.store.isStartingNextWorker || !self.store.canStartNextWorker)
                Button {
                    Task { await self.store.refresh() }
                } label: {
                    Label("Refresh", systemImage: "arrow.clockwise")
                }
                .buttonStyle(.bordered)
            }

            if let error = self.store.lastError {
                Text(error)
                    .font(.callout)
                    .foregroundStyle(.orange)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(Color.orange.opacity(0.12)))
            }

            if let gatewayStatus = self.store.gatewayStatus {
                CockpitGatewayStatusBanner(store: self.store, gatewayStatus: gatewayStatus)
            }

            if let snapshot = self.store.snapshot {
                ScrollView {
                    VStack(alignment: .leading, spacing: 18) {
                        CockpitMetricStrip(snapshot: snapshot)
                        HStack(alignment: .top, spacing: 16) {
                            CockpitLaneSection(
                                lanes: snapshot.activeLanes,
                                selectedWorkerId: self.store.selectedWorkerId,
                                onSelect: { workerId in
                                    Task { await self.store.selectWorker(workerId) }
                                })
                            CockpitSelectedWorkerSection(store: self.store)
                        }
                        HStack(alignment: .top, spacing: 16) {
                            CockpitRunsSection(runs: snapshot.recentRuns)
                            CockpitTasksSection(tasks: snapshot.recentTasks)
                        }
                        CockpitReviewPanel(store: self.store)
                            .frame(minHeight: 400)
                        CockpitFinishedWorkPanel(store: self.store)
                            .frame(minHeight: 360)
                    }
                }
            } else if self.store.isLoading {
                VStack {
                    Spacer()
                    ProgressView("Loading cockpit…")
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                ContentUnavailableView(
                    "No cockpit data yet",
                    systemImage: "rectangle.3.group",
                    description: Text("Use Start Next Worker to import work from FAST-TODO after the gateway is ready."))
            }
        }
        .padding(20)
        .frame(minWidth: 1180, minHeight: 760)
        .task {
            await self.store.refreshIfNeeded()
        }
    }
}

@MainActor
final class CockpitWindowController: NSWindowController {
    let store: CockpitStore

    init(store: CockpitStore) {
        self.store = store
        let rootView = CockpitWindow(store: store)
        let hostingController = NSHostingController(rootView: rootView)
        let window = NSWindow(contentViewController: hostingController)
        window.title = "Arc"
        window.setContentSize(NSSize(width: 1280, height: 860))
        window.minSize = NSSize(width: 1100, height: 720)
        window.styleMask = [.titled, .closable, .miniaturizable, .resizable]
        window.titleVisibility = .visible
        window.isReleasedWhenClosed = false
        window.setFrameAutosaveName("OpenClawCockpitWindow")
        super.init(window: window)
        self.shouldCascadeWindows = true
    }

    @available(*, unavailable)
    required init?(coder: NSCoder) {
        fatalError("init(coder:) has not been implemented")
    }
}

@MainActor
final class CockpitWindowManager {
    static let shared = CockpitWindowManager()

    private let store = CockpitStore.shared
    private var controller: CockpitWindowController?

    func show() {
        if self.controller == nil {
            self.controller = CockpitWindowController(store: self.store)
        }
        self.controller?.showWindow(nil)
        self.controller?.window?.makeKeyAndOrderFront(nil)
        NSApp.activate(ignoringOtherApps: true)
        Task { await self.store.refresh() }
    }
}

private struct CockpitGatewayStatusBanner: View {
    @Bindable var store: CockpitStore
    let gatewayStatus: CockpitGatewayStatus

    var body: some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: self.iconName)
                .font(.title3)
                .foregroundStyle(self.tintColor)

            VStack(alignment: .leading, spacing: 4) {
                Text(self.gatewayStatus.headline)
                    .font(.headline)
                Text(self.gatewayStatus.detailText)
                    .font(.callout)
                    .foregroundStyle(.secondary)
                if let endpointLabel = self.gatewayStatus.endpointLabel,
                   !endpointLabel.isEmpty,
                   self.gatewayStatus.state == .ready
                {
                    Text(endpointLabel)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
            }

            Spacer()

            HStack(spacing: 8) {
                if self.gatewayStatus.isRemote {
                    Button {
                        Task { await self.store.reconnectRemoteGateway() }
                    } label: {
                        if self.store.isRepairingRemoteConnection {
                            Label("Reconnecting…", systemImage: "dot.radiowaves.left.and.right")
                        } else {
                            Label("Reconnect", systemImage: "dot.radiowaves.left.and.right")
                        }
                    }
                    .buttonStyle(.borderedProminent)
                    .disabled(self.store.isRepairingRemoteConnection || self.gatewayStatus.state == .ready)
                } else {
                    Button {
                        SettingsWindowOpener.shared.open()
                    } label: {
                        Label("Open Settings", systemImage: "gearshape")
                    }
                    .buttonStyle(.bordered)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(self.tintColor.opacity(0.12)))
    }

    private var iconName: String {
        switch (self.gatewayStatus.mode, self.gatewayStatus.state) {
        case (.remote, .ready):
            "externaldrive.connected.to.line.below"
        case (.remote, .connecting):
            "network"
        case (.remote, .unavailable):
            "wifi.exclamationmark"
        case (.local, .ready):
            "laptopcomputer"
        case (.local, .connecting):
            "network"
        case (.local, .unavailable):
            "exclamationmark.triangle.fill"
        case (.unconfigured, _):
            "gearshape.2"
        }
    }

    private var tintColor: Color {
        switch self.gatewayStatus.state {
        case .ready:
            self.gatewayStatus.isRemote ? .blue : .green
        case .connecting:
            .orange
        case .unavailable:
            .red
        }
    }
}

private struct CockpitMetricStrip: View {
    let snapshot: CockpitWorkspaceSummary

    var body: some View {
        HStack(spacing: 12) {
            CockpitMetricCard(label: "Tasks", value: "\(self.snapshot.totals.tasks)")
            CockpitMetricCard(label: "Workers", value: "\(self.snapshot.totals.workers)")
            CockpitMetricCard(label: "Reviews", value: "\(self.snapshot.totals.reviews)")
            CockpitMetricCard(label: "Runs", value: "\(self.snapshot.totals.runs)")
        }
    }
}

private struct CockpitMetricCard: View {
    let label: String
    let value: String

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(self.label)
                .font(.caption)
                .foregroundStyle(.secondary)
            Text(self.value)
                .font(.title2.weight(.semibold))
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.05)))
    }
}

private struct CockpitLaneSection: View {
    let lanes: [CockpitLaneSummary]
    let selectedWorkerId: String?
    let onSelect: (String) -> Void

    private let columns = [
        GridItem(.flexible(minimum: 280), spacing: 12),
        GridItem(.flexible(minimum: 280), spacing: 12),
    ]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Workers")
                .font(.title3.weight(.semibold))
            if self.lanes.isEmpty {
                sectionPlaceholder("No workers yet. Start the next worker to populate the cockpit.")
            } else {
                LazyVGrid(columns: self.columns, alignment: .leading, spacing: 12) {
                    ForEach(self.lanes) { lane in
                        Button {
                            self.onSelect(lane.workerId)
                        } label: {
                            VStack(alignment: .leading, spacing: 8) {
                                HStack {
                                    Text(lane.workerName)
                                        .font(.headline)
                                    Spacer()
                                    Text(lane.status.replacingOccurrences(of: "_", with: " "))
                                        .font(.caption.weight(.medium))
                                        .foregroundStyle(.secondary)
                                }
                                Text(lane.taskTitle)
                                    .font(.subheadline)
                                    .multilineTextAlignment(.leading)
                                if let branch = lane.branch {
                                    Text(branch)
                                        .font(.caption.monospaced())
                                        .foregroundStyle(.secondary)
                                }
                                if let summary = lane.latestRun?.summary, !summary.isEmpty {
                                    Text(summary)
                                        .font(.caption)
                                        .foregroundStyle(.secondary)
                                        .multilineTextAlignment(.leading)
                                }
                                if let review = lane.pendingReview {
                                    Text("Pending review: \(review.title)")
                                        .font(.caption)
                                        .foregroundStyle(.orange)
                                        .multilineTextAlignment(.leading)
                                }
                            }
                            .padding(14)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                RoundedRectangle(cornerRadius: 12, style: .continuous)
                                    .fill(self.selectedWorkerId == lane.workerId ? Color.accentColor.opacity(0.14) : Color.primary.opacity(0.04)))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CockpitSelectedWorkerSection: View {
    @Bindable var store: CockpitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Selected Worker")
                .font(.title3.weight(.semibold))
            if let lane = self.store.selectedLane {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top) {
                        VStack(alignment: .leading, spacing: 4) {
                            Text(lane.workerName)
                                .font(.headline)
                            Text(lane.taskTitle)
                                .font(.subheadline)
                                .foregroundStyle(.secondary)
                        }
                        Spacer()
                        if self.store.isPerformingWorkerAction {
                            ProgressView()
                                .controlSize(.small)
                        }
                    }

                    HStack(spacing: 8) {
                        ForEach(lane.availableWorkerActions) { action in
                            Button {
                                Task { await self.store.performWorkerAction(action, workerId: lane.workerId) }
                            } label: {
                                Label(action.title, systemImage: action.systemImage)
                            }
                            .buttonStyle(.borderedProminent)
                            .disabled(self.store.isPerformingWorkerAction)
                        }
                    }

                    if let objective = lane.objective, !objective.isEmpty {
                        Text(objective)
                            .font(.callout)
                    }

                    if let branch = lane.branch {
                        LabeledContent("Branch") {
                            Text(branch)
                                .font(.caption.monospaced())
                        }
                    }

                    if let backendId = lane.backendId {
                        LabeledContent("Backend") {
                            Text(backendId)
                                .font(.caption.monospaced())
                        }
                    }

                    if let latestRun = lane.latestRun {
                        VStack(alignment: .leading, spacing: 4) {
                            Text("Latest Run")
                                .font(.caption.weight(.semibold))
                            Text(latestRun.status.replacingOccurrences(of: "_", with: " "))
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            if let summary = latestRun.summary, !summary.isEmpty {
                                Text(summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                    }

                    Divider()

                    VStack(alignment: .leading, spacing: 6) {
                        HStack {
                            Text("Logs")
                                .font(.caption.weight(.semibold))
                            if self.store.isLoadingWorkerLogs {
                                ProgressView()
                                    .controlSize(.small)
                            }
                        }
                        Text(self.logText)
                            .font(.caption.monospaced())
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(10)
                            .background(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .fill(Color.primary.opacity(0.04)))
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.04)))
            } else {
                sectionPlaceholder("Select a worker lane to inspect controls and logs.")
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private var logText: String {
        guard let logs = self.store.selectedWorkerLogs else {
            return "No logs loaded yet."
        }
        let stdout = logs.stdoutTail.trimmingCharacters(in: .whitespacesAndNewlines)
        let stderr = logs.stderrTail.trimmingCharacters(in: .whitespacesAndNewlines)
        if stdout.isEmpty && stderr.isEmpty {
            return "No log output yet."
        }
        if stderr.isEmpty { return stdout }
        if stdout.isEmpty { return stderr }
        return "\(stdout)\n\nstderr:\n\(stderr)"
    }
}

private struct CockpitRunsSection: View {
    let runs: [CockpitRunSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Runs")
                .font(.title3.weight(.semibold))
            if self.runs.isEmpty {
                sectionPlaceholder("No worker runs yet.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(self.runs.prefix(6)) { run in
                        VStack(alignment: .leading, spacing: 4) {
                            HStack {
                                Text(run.id)
                                    .font(.caption.monospaced())
                                Spacer()
                                Text(run.status)
                                    .font(.caption2)
                                    .foregroundStyle(.secondary)
                            }
                            if let summary = run.summary, !summary.isEmpty {
                                Text(summary)
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                        }
                        .padding(.bottom, 6)
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.04)))
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

// MARK: - Review Panel

private struct CockpitReviewPanel: View {
    @Bindable var store: CockpitStore
    @State private var selectedTab: CockpitReviewTab = .changes
    @State private var selectedFilePath: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CockpitReviewPanelHeader(store: self.store, selectedTab: self.$selectedTab)

            if let diff = self.store.selectedWorkerDiff {
                switch self.selectedTab {
                case .changes:
                    CockpitReviewChangesTab(
                        diff: diff,
                        selectedFilePath: self.$selectedFilePath)
                case .tests:
                    CockpitReviewTestsTab(diff: diff)
                case .logs:
                    CockpitReviewLogsTab(logs: self.store.selectedWorkerLogs)
                }
            } else if self.store.isLoadingWorkerDiff {
                VStack {
                    Spacer()
                    ProgressView("Loading review data…")
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack {
                    Spacer()
                    ContentUnavailableView(
                        "No review data",
                        systemImage: "doc.text.magnifyingglass",
                        description: Text("Select a worker with finished work to review changes, tests, and logs."))
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.03)))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
    }
}

private struct CockpitReviewPanelHeader: View {
    @Bindable var store: CockpitStore
    @Binding var selectedTab: CockpitReviewTab

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Review")
                        .font(.title3.weight(.semibold))
                    if let diff = self.store.selectedWorkerDiff {
                        CockpitReviewBranchBar(diff: diff)
                    }
                }

                Spacer()

                if self.store.isLoadingWorkerDiff {
                    ProgressView()
                        .controlSize(.small)
                }

                if let diff = self.store.selectedWorkerDiff {
                    CockpitReviewStatsChip(diff: diff)
                }

                if let review = self.store.selectedLane?.pendingReview {
                    CockpitReviewActionBar(store: self.store, review: review)
                }

                if self.store.selectedWorkerDiff != nil {
                    Button {
                        Task { await self.store.loadDiffForSelectedWorker() }
                    } label: {
                        Label("Reload", systemImage: "arrow.clockwise")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)

            HStack(spacing: 0) {
                ForEach(CockpitReviewTab.allCases) { tab in
                    CockpitReviewTabButton(
                        tab: tab,
                        isSelected: self.selectedTab == tab,
                        badge: self.badge(for: tab))
                    {
                        self.selectedTab = tab
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 14)

            Divider()
        }
    }

    private func badge(for tab: CockpitReviewTab) -> CockpitReviewTabBadge? {
        guard let diff = self.store.selectedWorkerDiff else { return nil }
        switch tab {
        case .changes:
            return .count(diff.changedFiles.count)
        case .tests:
            if diff.testOutput.isEmpty { return nil }
            return diff.hasTestFailures ? .failure : .success
        case .logs:
            return nil
        }
    }
}

private enum CockpitReviewTabBadge {
    case count(Int)
    case success
    case failure
}

private struct CockpitReviewTabButton: View {
    let tab: CockpitReviewTab
    let isSelected: Bool
    let badge: CockpitReviewTabBadge?
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            HStack(spacing: 5) {
                Image(systemName: self.tab.systemImage)
                    .font(.caption2)
                Text(self.tab.title)
                    .font(.caption.weight(self.isSelected ? .semibold : .regular))
                if let badge {
                    switch badge {
                    case let .count(n):
                        Text("\(n)")
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.secondary.opacity(0.2)))
                    case .success:
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.green)
                    case .failure:
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(self.isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct CockpitReviewBranchBar: View {
    let diff: CockpitWorkerDiff

    var body: some View {
        HStack(spacing: 8) {
            if let branch = self.diff.branch {
                Image(systemName: "arrow.triangle.branch")
                    .font(.caption2)
                    .foregroundStyle(.secondary)
                Text(branch)
                    .font(.caption.monospaced())
                Text("vs")
                    .font(.caption2)
                    .foregroundStyle(.tertiary)
                Text(self.diff.baseBranch)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
            }
            if let prUrl = self.diff.pullRequestUrl {
                Divider()
                    .frame(height: 12)
                Label {
                    Text(Self.prShortLabel(prUrl))
                        .font(.caption.monospaced())
                        .lineLimit(1)
                } icon: {
                    Image(systemName: "link")
                        .font(.caption2)
                }
                .foregroundStyle(.blue)
                .onTapGesture {
                    if let url = URL(string: prUrl) {
                        NSWorkspace.shared.open(url)
                    }
                }
            }
            if let prState = self.diff.pullRequestState {
                Text(prState)
                    .font(.system(size: 10, weight: .medium))
                    .padding(.horizontal, 5)
                    .padding(.vertical, 1)
                    .background(
                        Capsule()
                            .fill(Self.prStateColor(prState).opacity(0.15)))
                    .foregroundStyle(Self.prStateColor(prState))
            }
        }
    }

    private static func prShortLabel(_ url: String) -> String {
        // "https://github.com/openclaw/openclaw/pull/42" -> "#42"
        if let last = url.split(separator: "/").last, let num = Int(last) {
            return "#\(num)"
        }
        return url
    }

    private static func prStateColor(_ state: String) -> Color {
        switch state {
        case "merged": .purple
        case "open": .green
        case "draft": .orange
        case "closed": .red
        default: .secondary
        }
    }
}

private struct CockpitReviewStatsChip: View {
    let diff: CockpitWorkerDiff

    var body: some View {
        let totalAdditions = self.diff.changedFiles.reduce(0) { $0 + $1.additions }
        let totalDeletions = self.diff.changedFiles.reduce(0) { $0 + $1.deletions }
        HStack(spacing: 6) {
            Text("\(self.diff.changedFiles.count) file\(self.diff.changedFiles.count == 1 ? "" : "s")")
                .font(.caption2)
                .foregroundStyle(.secondary)
            Text("+\(totalAdditions)")
                .font(.caption2.monospaced())
                .foregroundStyle(.green)
            Text("-\(totalDeletions)")
                .font(.caption2.monospaced())
                .foregroundStyle(.red)
        }
        .padding(.horizontal, 8)
        .padding(.vertical, 4)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(Color.primary.opacity(0.05)))
    }
}

private struct CockpitReviewActionBar: View {
    @Bindable var store: CockpitStore
    let review: CockpitReviewSummary

    var body: some View {
        HStack(spacing: 6) {
            ForEach(CockpitReviewAction.allCases) { action in
                Button {
                    Task { await self.store.resolveReview(action, reviewId: self.review.id) }
                } label: {
                    Label(action.title, systemImage: action.systemImage)
                        .font(.caption)
                }
                .buttonStyle(action == .approve ? .borderedProminent : .bordered)
                .tint(action.tintColor)
                .controlSize(.small)
                .disabled(self.store.isResolvingReview)
            }
        }
    }
}

// MARK: - Changes Tab

private struct CockpitReviewChangesTab: View {
    let diff: CockpitWorkerDiff
    @Binding var selectedFilePath: String?

    var body: some View {
        HSplitView {
            CockpitFileListSidebar(
                files: self.diff.changedFiles,
                selectedFilePath: self.$selectedFilePath,
                commits: self.diff.commitLog)
                .frame(minWidth: 200, idealWidth: 260, maxWidth: 320)

            CockpitFileDiffViewer(
                diff: self.diff,
                selectedFilePath: self.selectedFilePath)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct CockpitFileListSidebar: View {
    let files: [CockpitChangedFile]
    @Binding var selectedFilePath: String?
    let commits: [CockpitCommitEntry]?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            if let commits, !commits.isEmpty {
                VStack(alignment: .leading, spacing: 0) {
                    Text("Commits (\(commits.count))")
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 10)
                        .padding(.vertical, 6)
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            ForEach(commits) { commit in
                                HStack(alignment: .top, spacing: 6) {
                                    Text(commit.shortSha)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(.blue)
                                        .frame(width: 56, alignment: .leading)
                                    Text(commit.subject)
                                        .font(.system(size: 11))
                                        .lineLimit(2)
                                }
                                .padding(.horizontal, 10)
                                .padding(.vertical, 3)
                            }
                        }
                    }
                    .frame(maxHeight: 120)
                }
                .padding(.bottom, 4)
                Divider()
            }

            Text("Changed Files (\(self.files.count))")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    // "All files" entry
                    Button {
                        self.selectedFilePath = nil
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.on.doc")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .frame(width: 14)
                            Text("All files")
                                .font(.caption)
                            Spacer()
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 4)
                        .background(self.selectedFilePath == nil ? Color.accentColor.opacity(0.12) : Color.clear)
                        .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                    }
                    .buttonStyle(.plain)

                    ForEach(self.files) { file in
                        Button {
                            self.selectedFilePath = file.path
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: Self.statusIcon(file.status))
                                    .font(.caption2)
                                    .foregroundStyle(Self.statusColor(file.status))
                                    .frame(width: 14)
                                Text(Self.fileName(file.path))
                                    .font(.caption)
                                    .lineLimit(1)
                                    .truncationMode(.middle)
                                    .help(file.path)
                                Spacer()
                                HStack(spacing: 2) {
                                    Text("+\(file.additions)")
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.green)
                                    Text("-\(file.deletions)")
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.red)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(self.selectedFilePath == file.path ? Color.accentColor.opacity(0.12) : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 4, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private static func fileName(_ path: String) -> String {
        (path as NSString).lastPathComponent
    }

    private static func statusIcon(_ status: String) -> String {
        switch status {
        case "added": "plus.circle.fill"
        case "deleted": "minus.circle.fill"
        case "renamed": "arrow.right.circle.fill"
        default: "pencil.circle.fill"
        }
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "added": .green
        case "deleted": .red
        case "renamed": .blue
        default: .orange
        }
    }
}

private struct CockpitFileDiffViewer: View {
    let diff: CockpitWorkerDiff
    let selectedFilePath: String?

    var body: some View {
        let content = self.diffContent
        if content.isEmpty {
            VStack {
                Spacer()
                Text("No diff content.")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            ScrollView([.horizontal, .vertical], showsIndicators: true) {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(Array(content.split(separator: "\n", omittingEmptySubsequences: false).enumerated()), id: \.offset) { _, line in
                        Text(String(line))
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(Self.lineColor(String(line)))
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 0.5)
                            .background(Self.lineBackground(String(line)))
                    }
                }
                .textSelection(.enabled)
                .padding(.vertical, 6)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private var diffContent: String {
        guard let path = self.selectedFilePath else {
            return self.diff.unifiedDiff
        }
        let fileDiffs = self.diff.fileDiffs
        return fileDiffs.first(where: { $0.path == path })?.hunks ?? ""
    }

    private static func lineColor(_ line: String) -> Color {
        if line.hasPrefix("+++") || line.hasPrefix("---") {
            return .secondary
        }
        if line.hasPrefix("+") { return .green }
        if line.hasPrefix("-") { return .red }
        if line.hasPrefix("@@") { return .blue }
        if line.hasPrefix("diff --git") { return .secondary }
        return .primary
    }

    private static func lineBackground(_ line: String) -> Color {
        if line.hasPrefix("+") && !line.hasPrefix("+++") {
            return Color.green.opacity(0.08)
        }
        if line.hasPrefix("-") && !line.hasPrefix("---") {
            return Color.red.opacity(0.08)
        }
        if line.hasPrefix("@@") {
            return Color.blue.opacity(0.06)
        }
        return .clear
    }
}

// MARK: - Tests Tab

private struct CockpitReviewTestsTab: View {
    let diff: CockpitWorkerDiff

    var body: some View {
        if self.diff.testOutput.isEmpty {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "No test output",
                    systemImage: "checkmark.diamond",
                    description: Text("No test results were captured for this worker run."))
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack(alignment: .leading, spacing: 0) {
                CockpitTestSummaryBanner(diff: self.diff)
                Divider()
                ScrollView([.horizontal, .vertical], showsIndicators: true) {
                    Text(self.diff.testOutput)
                        .font(.system(size: 11, design: .monospaced))
                        .textSelection(.enabled)
                        .padding(12)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        }
    }
}

private struct CockpitTestSummaryBanner: View {
    let diff: CockpitWorkerDiff

    var body: some View {
        HStack(spacing: 10) {
            Image(systemName: self.diff.hasTestFailures ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                .font(.title3)
                .foregroundStyle(self.diff.hasTestFailures ? .red : .green)
            VStack(alignment: .leading, spacing: 2) {
                Text(self.diff.hasTestFailures ? "Tests failed" : "Tests passed")
                    .font(.headline)
                if let summary = self.diff.testSummaryLine {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
            Spacer()
        }
        .padding(12)
        .background(self.diff.hasTestFailures ? Color.red.opacity(0.06) : Color.green.opacity(0.06))
    }
}

// MARK: - Logs Tab

private struct CockpitReviewLogsTab: View {
    let logs: CockpitWorkerLogs?

    var body: some View {
        if let logs {
            VStack(alignment: .leading, spacing: 0) {
                if let latestRun = logs.latestRun {
                    HStack(spacing: 8) {
                        Text("Run")
                            .font(.caption.weight(.semibold))
                            .foregroundStyle(.secondary)
                        Text(latestRun.id)
                            .font(.caption.monospaced())
                        Text(latestRun.status.replacingOccurrences(of: "_", with: " "))
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        if let summary = latestRun.summary, !summary.isEmpty {
                            Text(summary)
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                        Spacer()
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    Divider()
                }

                CockpitLogStreamView(
                    title: "stdout",
                    content: logs.stdoutTail)

                if !logs.stderrTail.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    Divider()
                    CockpitLogStreamView(
                        title: "stderr",
                        content: logs.stderrTail,
                        tint: .orange)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "No logs",
                    systemImage: "terminal",
                    description: Text("Log output will appear here once the worker has run."))
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct CockpitLogStreamView: View {
    let title: String
    let content: String
    var tint: Color = .primary

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text(self.title)
                .font(.caption.weight(.semibold))
                .foregroundStyle(self.tint == .primary ? .secondary : self.tint)
                .padding(.horizontal, 12)
                .padding(.vertical, 6)
            ScrollView([.horizontal, .vertical], showsIndicators: true) {
                Text(self.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                    ? "No output."
                    : self.content)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(self.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? .secondary : self.tint)
                    .textSelection(.enabled)
                    .padding(.horizontal, 12)
                    .padding(.bottom, 12)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

// MARK: - Finished Work Panel

private struct CockpitFinishedWorkPanel: View {
    @Bindable var store: CockpitStore
    @State private var selectedTab: CockpitFinishedWorkTab = .overview
    @State private var selectedFilePath: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            CockpitFinishedWorkHeader(
                store: self.store,
                selectedTab: self.$selectedTab,
                diff: self.store.finishedWorkerDiff,
                detail: self.store.finishedWorkerDetail)

            if let finishedLanes = self.store.snapshot?.finishedLanes, finishedLanes.isEmpty {
                VStack {
                    Spacer()
                    ContentUnavailableView(
                        "No finished work",
                        systemImage: "checkmark.rectangle.stack",
                        description: Text("Completed, failed, or cancelled workers will appear here for review."))
                    Spacer()
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                HSplitView {
                    CockpitFinishedLanePicker(store: self.store)
                        .frame(minWidth: 200, idealWidth: 260, maxWidth: 320)

                    VStack(alignment: .leading, spacing: 0) {
                        if self.selectedTab == .overview {
                            CockpitFinishedOverviewTab(
                                store: self.store,
                                lane: self.store.selectedFinishedLane,
                                diff: self.store.finishedWorkerDiff,
                                detail: self.store.finishedWorkerDetail,
                                logs: self.store.finishedWorkerLogs,
                                isLoading: self.store.isLoadingFinishedDiff || self.store.isLoadingFinishedDetail)
                        } else if self.selectedTab == .runs {
                            CockpitFinishedRunsTab(
                                detail: self.store.finishedWorkerDetail,
                                isLoading: self.store.isLoadingFinishedDetail)
                        } else if let diff = self.store.finishedWorkerDiff {
                            switch self.selectedTab {
                            case .changes:
                                CockpitReviewChangesTab(
                                    diff: diff,
                                    selectedFilePath: self.$selectedFilePath)
                            case .tests:
                                CockpitReviewTestsTab(diff: diff)
                            case .logs:
                                CockpitReviewLogsTab(logs: self.store.finishedWorkerLogs)
                            case .overview, .runs:
                                EmptyView()
                            }
                        } else if self.store.isLoadingFinishedDiff {
                            VStack {
                                Spacer()
                                ProgressView("Loading finished work data…")
                                Spacer()
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        } else {
                            VStack {
                                Spacer()
                                ContentUnavailableView(
                                    "Select a finished worker",
                                    systemImage: "doc.text.magnifyingglass",
                                    description: Text("Pick a worker from the list to inspect changes, tests, and logs."))
                                Spacer()
                            }
                            .frame(maxWidth: .infinity, maxHeight: .infinity)
                        }
                    }
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.03)))
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .onChange(of: self.store.selectedFinishedWorkerId) {
            self.selectedFilePath = nil
        }
    }
}

private struct CockpitFinishedWorkHeader: View {
    @Bindable var store: CockpitStore
    @Binding var selectedTab: CockpitFinishedWorkTab
    let diff: CockpitWorkerDiff?
    let detail: CockpitWorkerDetail?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .top, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("Finished Work")
                        .font(.title3.weight(.semibold))
                    if let lane = self.store.selectedFinishedLane {
                        HStack(spacing: 6) {
                            Image(systemName: Self.statusIcon(lane.status))
                                .font(.caption)
                                .foregroundStyle(Self.statusColor(lane.status))
                            Text(lane.workerName)
                                .font(.caption.weight(.medium))
                            Text(lane.status.replacingOccurrences(of: "_", with: " "))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                            if let backendId = lane.backendId, !backendId.isEmpty {
                                Text(backendId)
                                    .font(.system(size: 9, design: .monospaced))
                                    .padding(.horizontal, 4)
                                    .padding(.vertical, 1)
                                    .background(Capsule().fill(Color.secondary.opacity(0.12)))
                                    .foregroundStyle(.secondary)
                            }
                        }
                        if let objective = lane.objective, !objective.isEmpty {
                            Text(objective)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                    if let diff, diff.branch != nil {
                        CockpitReviewBranchBar(diff: diff)
                    }
                }

                Spacer()

                if self.store.isLoadingFinishedDiff || self.store.isLoadingFinishedDetail {
                    ProgressView()
                        .controlSize(.small)
                }

                if let diff {
                    CockpitReviewStatsChip(diff: diff)
                }

                if let lane = self.store.selectedFinishedLane {
                    if let review = lane.pendingReview {
                        CockpitReviewActionBar(store: self.store, review: review)
                    }
                    CockpitFinishedWorkerActions(store: self.store, lane: lane)
                }

                if self.store.finishedWorkerDiff != nil {
                    Button {
                        Task { await self.store.reloadFinishedWorkerDiff() }
                    } label: {
                        Label("Reload", systemImage: "arrow.clockwise")
                            .font(.caption)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.small)
                }
            }
            .padding(.horizontal, 14)
            .padding(.top, 12)
            .padding(.bottom, 10)

            HStack(spacing: 0) {
                ForEach(CockpitFinishedWorkTab.allCases) { tab in
                    CockpitFinishedWorkTabButton(
                        tab: tab,
                        isSelected: self.selectedTab == tab,
                        badge: self.badge(for: tab))
                    {
                        self.selectedTab = tab
                    }
                }
                Spacer()
            }
            .padding(.horizontal, 14)

            Divider()
        }
    }

    private func badge(for tab: CockpitFinishedWorkTab) -> CockpitReviewTabBadge? {
        switch tab {
        case .overview:
            return nil
        case .changes:
            guard let diff else { return nil }
            return .count(diff.changedFiles.count)
        case .tests:
            guard let diff else { return nil }
            if diff.testOutput.isEmpty { return nil }
            return diff.hasTestFailures ? .failure : .success
        case .logs:
            return nil
        case .runs:
            if let detail {
                return .count(detail.runs.count)
            }
            return nil
        }
    }

    private static func statusIcon(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "slash.circle.fill"
        default: "circle.fill"
        }
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "completed": .green
        case "failed": .red
        case "cancelled": .orange
        default: .secondary
        }
    }
}

private struct CockpitFinishedWorkerActions: View {
    @Bindable var store: CockpitStore
    let lane: CockpitLaneSummary

    var body: some View {
        let actions = self.lane.availableWorkerActions
        if !actions.isEmpty {
            HStack(spacing: 6) {
                ForEach(actions) { action in
                    Button {
                        Task { await self.store.performWorkerAction(action, workerId: self.lane.workerId) }
                    } label: {
                        Label(action.title, systemImage: action.systemImage)
                            .font(.caption)
                    }
                    .buttonStyle(action == .start ? .borderedProminent : .bordered)
                    .controlSize(.small)
                    .disabled(self.store.isPerformingWorkerAction)
                }
            }
        }
    }
}

private struct CockpitFinishedWorkTabButton: View {
    let tab: CockpitFinishedWorkTab
    let isSelected: Bool
    let badge: CockpitReviewTabBadge?
    let action: () -> Void

    var body: some View {
        Button(action: self.action) {
            HStack(spacing: 5) {
                Image(systemName: self.tab.systemImage)
                    .font(.caption2)
                Text(self.tab.title)
                    .font(.caption.weight(self.isSelected ? .semibold : .regular))
                if let badge {
                    switch badge {
                    case let .count(n):
                        Text("\(n)")
                            .font(.system(size: 9, weight: .bold, design: .rounded))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.secondary.opacity(0.2)))
                    case .success:
                        Image(systemName: "checkmark.circle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.green)
                    case .failure:
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 10))
                            .foregroundStyle(.red)
                    }
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 6)
            .background(self.isSelected ? Color.accentColor.opacity(0.12) : Color.clear)
            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
    }
}

private struct CockpitFinishedOverviewTab: View {
    @Bindable var store: CockpitStore
    let lane: CockpitLaneSummary?
    let diff: CockpitWorkerDiff?
    let detail: CockpitWorkerDetail?
    let logs: CockpitWorkerLogs?
    let isLoading: Bool

    var body: some View {
        if self.isLoading && self.diff == nil && self.detail == nil {
            VStack {
                Spacer()
                ProgressView("Loading overview…")
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let lane {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    // Objective and context
                    CockpitOverviewContextCard(lane: lane, diff: self.diff)

                    HStack(alignment: .top, spacing: 12) {
                        // Changed files summary
                        CockpitOverviewChangesCard(diff: self.diff)
                        // Test summary
                        CockpitOverviewTestCard(diff: self.diff)
                    }

                    HStack(alignment: .top, spacing: 12) {
                        // Run history summary
                        CockpitOverviewRunsCard(detail: self.detail, lane: lane)
                        // Review status
                        CockpitOverviewReviewCard(store: self.store, lane: lane)
                    }

                    // Log tail preview
                    CockpitOverviewLogCard(logs: self.logs)
                }
                .padding(14)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "Select a finished worker",
                    systemImage: "rectangle.3.group",
                    description: Text("Pick a worker to see a summary of changes, tests, and run history."))
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }
}

private struct CockpitOverviewContextCard: View {
    let lane: CockpitLaneSummary
    let diff: CockpitWorkerDiff?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: Self.statusIcon(self.lane.status))
                    .font(.title2)
                    .foregroundStyle(Self.statusColor(self.lane.status))
                VStack(alignment: .leading, spacing: 4) {
                    Text(self.lane.taskTitle)
                        .font(.headline)
                    Text(self.lane.workerName)
                        .font(.subheadline)
                        .foregroundStyle(.secondary)
                }
                Spacer()
                if let backendId = self.lane.backendId, !backendId.isEmpty {
                    Text(backendId)
                        .font(.caption.monospaced())
                        .padding(.horizontal, 6)
                        .padding(.vertical, 2)
                        .background(Capsule().fill(Color.secondary.opacity(0.12)))
                        .foregroundStyle(.secondary)
                }
            }

            if let objective = self.lane.objective, !objective.isEmpty {
                Text(objective)
                    .font(.callout)
                    .foregroundStyle(.secondary)
            }

            if let diff, diff.branch != nil {
                CockpitReviewBranchBar(diff: diff)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }

    private static func statusIcon(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "slash.circle.fill"
        default: "circle.fill"
        }
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "completed": .green
        case "failed": .red
        case "cancelled": .orange
        default: .secondary
        }
    }
}

private struct CockpitOverviewChangesCard: View {
    let diff: CockpitWorkerDiff?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Changes", systemImage: "doc.text.magnifyingglass")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let diff {
                let totalAdditions = diff.changedFiles.reduce(0) { $0 + $1.additions }
                let totalDeletions = diff.changedFiles.reduce(0) { $0 + $1.deletions }
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(diff.changedFiles.count)")
                            .font(.title2.weight(.semibold))
                        Text("file\(diff.changedFiles.count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("+\(totalAdditions)")
                            .font(.title3.weight(.semibold).monospaced())
                            .foregroundStyle(.green)
                        Text("added")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    VStack(alignment: .leading, spacing: 2) {
                        Text("-\(totalDeletions)")
                            .font(.title3.weight(.semibold).monospaced())
                            .foregroundStyle(.red)
                        Text("removed")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                }

                if let commits = diff.commitLog, !commits.isEmpty {
                    Divider()
                    HStack(spacing: 4) {
                        Image(systemName: "point.3.connected.trianglepath.dotted")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                        Text("\(commits.count) commit\(commits.count == 1 ? "" : "s")")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        if let latest = commits.first {
                            Text(latest.shortSha)
                                .font(.caption.monospaced())
                                .foregroundStyle(.blue)
                        }
                    }
                }
            } else {
                Text("No diff data")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }
}

private struct CockpitOverviewTestCard: View {
    let diff: CockpitWorkerDiff?

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Tests", systemImage: "checkmark.diamond")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let diff, !diff.testOutput.isEmpty {
                HStack(spacing: 8) {
                    Image(systemName: diff.hasTestFailures ? "exclamationmark.triangle.fill" : "checkmark.circle.fill")
                        .font(.title2)
                        .foregroundStyle(diff.hasTestFailures ? .red : .green)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(diff.hasTestFailures ? "Failures detected" : "All passing")
                            .font(.subheadline.weight(.medium))
                        if let summary = diff.testSummaryLine {
                            Text(summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(2)
                        }
                    }
                }
            } else {
                HStack(spacing: 8) {
                    Image(systemName: "minus.circle")
                        .font(.title3)
                        .foregroundStyle(.tertiary)
                    Text("No test output captured")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }
}

private struct CockpitOverviewRunsCard: View {
    let detail: CockpitWorkerDetail?
    let lane: CockpitLaneSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Runs", systemImage: "clock.arrow.circlepath")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let detail, !detail.runs.isEmpty {
                HStack(spacing: 12) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text("\(detail.runs.count)")
                            .font(.title2.weight(.semibold))
                        Text("run\(detail.runs.count == 1 ? "" : "s")")
                            .font(.caption2)
                            .foregroundStyle(.secondary)
                    }
                    if let duration = Self.totalDuration(detail.runs) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(duration)
                                .font(.title3.weight(.medium).monospaced())
                            Text("total")
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                if let latestRun = detail.runs.first {
                    Divider()
                    HStack(spacing: 6) {
                        Text("Latest:")
                            .font(.caption)
                            .foregroundStyle(.secondary)
                        Text(latestRun.status.replacingOccurrences(of: "_", with: " "))
                            .font(.caption.weight(.medium))
                            .foregroundStyle(Self.statusColor(latestRun.status))
                        if let summary = latestRun.summary, !summary.isEmpty {
                            Text(summary)
                                .font(.caption)
                                .foregroundStyle(.secondary)
                                .lineLimit(1)
                        }
                    }
                }
            } else if let latestRun = self.lane.latestRun {
                HStack(spacing: 6) {
                    Text(latestRun.status.replacingOccurrences(of: "_", with: " "))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(Self.statusColor(latestRun.status))
                    if let summary = latestRun.summary, !summary.isEmpty {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(2)
                    }
                }
            } else {
                Text("No runs recorded")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }

    private static func totalDuration(_ runs: [CockpitRunSummary]) -> String? {
        let formatter = ISO8601DateFormatter()
        var totalSeconds: TimeInterval = 0
        for run in runs {
            guard let startStr = run.startedAt, let finishStr = run.finishedAt,
                  let start = formatter.date(from: startStr),
                  let finish = formatter.date(from: finishStr) else { continue }
            totalSeconds += finish.timeIntervalSince(start)
        }
        guard totalSeconds > 0 else { return nil }
        let minutes = Int(totalSeconds) / 60
        let seconds = Int(totalSeconds) % 60
        if minutes > 0 {
            return "\(minutes)m \(seconds)s"
        }
        return "\(seconds)s"
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "succeeded": .green
        case "failed": .red
        case "cancelled": .orange
        case "running": .blue
        default: .secondary
        }
    }
}

private struct CockpitOverviewReviewCard: View {
    @Bindable var store: CockpitStore
    let lane: CockpitLaneSummary

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Label("Review", systemImage: "checkmark.seal")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let review = self.lane.pendingReview {
                VStack(alignment: .leading, spacing: 8) {
                    HStack(spacing: 6) {
                        Image(systemName: "exclamationmark.circle.fill")
                            .font(.caption)
                            .foregroundStyle(.orange)
                        Text(review.title)
                            .font(.caption.weight(.medium))
                    }
                    if let summary = review.summary, !summary.isEmpty {
                        Text(summary)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                            .lineLimit(3)
                    }
                    HStack(spacing: 6) {
                        ForEach(CockpitReviewAction.allCases) { action in
                            Button {
                                Task { await self.store.resolveReview(action, reviewId: review.id) }
                            } label: {
                                Label(action.title, systemImage: action.systemImage)
                                    .font(.caption)
                            }
                            .buttonStyle(action == .approve ? .borderedProminent : .bordered)
                            .tint(action.tintColor)
                            .controlSize(.small)
                            .disabled(self.store.isResolvingReview)
                        }
                    }
                }
            } else {
                HStack(spacing: 6) {
                    Image(systemName: Self.reviewIcon(self.lane.status))
                        .font(.caption)
                        .foregroundStyle(Self.reviewColor(self.lane.status))
                    Text(Self.reviewLabel(self.lane.status))
                        .font(.caption)
                        .foregroundStyle(.secondary)
                }
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }

    private static func reviewIcon(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.seal.fill"
        case "failed": "xmark.seal.fill"
        case "cancelled": "slash.circle"
        default: "minus.circle"
        }
    }

    private static func reviewColor(_ status: String) -> Color {
        switch status {
        case "completed": .green
        case "failed": .red
        case "cancelled": .orange
        default: .secondary
        }
    }

    private static func reviewLabel(_ status: String) -> String {
        switch status {
        case "completed": "Approved or no review needed"
        case "failed": "Worker failed before review"
        case "cancelled": "Worker was cancelled"
        default: "No pending review"
        }
    }
}

private struct CockpitOverviewLogCard: View {
    let logs: CockpitWorkerLogs?

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Label("Log Tail", systemImage: "terminal")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)

            if let logs {
                let stdout = logs.stdoutTail.trimmingCharacters(in: .whitespacesAndNewlines)
                let stderr = logs.stderrTail.trimmingCharacters(in: .whitespacesAndNewlines)
                if stdout.isEmpty && stderr.isEmpty {
                    Text("No log output captured.")
                        .font(.caption)
                        .foregroundStyle(.tertiary)
                } else {
                    if !stdout.isEmpty {
                        Text(Self.tailLines(stdout, max: 12))
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.secondary)
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    if !stderr.isEmpty {
                        if !stdout.isEmpty { Divider() }
                        HStack(spacing: 4) {
                            Image(systemName: "exclamationmark.triangle")
                                .font(.system(size: 9))
                                .foregroundStyle(.orange)
                            Text("stderr")
                                .font(.system(size: 9, weight: .semibold))
                                .foregroundStyle(.orange)
                        }
                        Text(Self.tailLines(stderr, max: 8))
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(.orange.opacity(0.8))
                            .textSelection(.enabled)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                }
            } else {
                Text("Logs not loaded.")
                    .font(.caption)
                    .foregroundStyle(.tertiary)
            }
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
    }

    private static func tailLines(_ text: String, max: Int) -> String {
        let lines = text.split(separator: "\n", omittingEmptySubsequences: false)
        if lines.count <= max { return text }
        let tail = lines.suffix(max)
        return "…\n" + tail.joined(separator: "\n")
    }
}

private struct CockpitFinishedRunsTab: View {
    let detail: CockpitWorkerDetail?
    let isLoading: Bool

    var body: some View {
        if self.isLoading && self.detail == nil {
            VStack {
                Spacer()
                ProgressView("Loading run history…")
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        } else if let detail, !detail.runs.isEmpty {
            VStack(alignment: .leading, spacing: 0) {
                // Worker context strip
                HStack(spacing: 10) {
                    Image(systemName: "person.badge.clock")
                        .font(.title3)
                        .foregroundStyle(.secondary)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(detail.worker.name)
                            .font(.headline)
                        Text(detail.task.title)
                            .font(.caption)
                            .foregroundStyle(.secondary)
                    }
                    Spacer()
                    Text("\(detail.runs.count) run\(detail.runs.count == 1 ? "" : "s")")
                        .font(.caption2)
                        .foregroundStyle(.secondary)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 5, style: .continuous)
                                .fill(Color.secondary.opacity(0.1)))
                    if let totalDuration = Self.totalDuration(detail.runs) {
                        Text(totalDuration)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.secondary)
                    }
                }
                .padding(12)
                .background(Color.primary.opacity(0.02))

                Divider()

                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        ForEach(Array(detail.runs.enumerated()), id: \.element.id) { index, run in
                            CockpitRunTimelineRow(run: run, isLatest: index == 0)
                            if index < detail.runs.count - 1 {
                                Divider().padding(.leading, 40)
                            }
                        }
                    }
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
        } else {
            VStack {
                Spacer()
                ContentUnavailableView(
                    "No runs recorded",
                    systemImage: "clock.arrow.circlepath",
                    description: Text("This worker has no recorded run history."))
                Spacer()
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private static func totalDuration(_ runs: [CockpitRunSummary]) -> String? {
        let formatter = ISO8601DateFormatter()
        var totalSeconds: TimeInterval = 0
        for run in runs {
            guard let startStr = run.startedAt, let finishStr = run.finishedAt,
                  let start = formatter.date(from: startStr),
                  let finish = formatter.date(from: finishStr) else { continue }
            totalSeconds += finish.timeIntervalSince(start)
        }
        guard totalSeconds > 0 else { return nil }
        let minutes = Int(totalSeconds) / 60
        let seconds = Int(totalSeconds) % 60
        if minutes > 0 {
            return "\(minutes)m \(seconds)s total"
        }
        return "\(seconds)s total"
    }
}

private struct CockpitRunTimelineRow: View {
    let run: CockpitRunSummary
    let isLatest: Bool

    var body: some View {
        HStack(alignment: .top, spacing: 10) {
            // Status indicator
            VStack(spacing: 2) {
                Image(systemName: Self.statusIcon(self.run.status))
                    .font(.system(size: 14))
                    .foregroundStyle(Self.statusColor(self.run.status))
                    .frame(width: 24, height: 24)
            }
            .frame(width: 30)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text(Self.statusLabel(self.run.status))
                        .font(.caption.weight(.semibold))
                        .foregroundStyle(Self.statusColor(self.run.status))
                    if self.isLatest {
                        Text("latest")
                            .font(.system(size: 9, weight: .medium))
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(Capsule().fill(Color.accentColor.opacity(0.15)))
                            .foregroundStyle(.accentColor)
                    }
                    Spacer()
                    if let duration = self.durationLabel {
                        Text(duration)
                            .font(.caption2.monospaced())
                            .foregroundStyle(.tertiary)
                    }
                }

                if let summary = self.run.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .lineLimit(3)
                }

                HStack(spacing: 8) {
                    if let backendId = self.run.backendId, !backendId.isEmpty {
                        Text(backendId)
                            .font(.system(size: 9, design: .monospaced))
                            .foregroundStyle(.tertiary)
                    }
                    if let startedAt = self.run.startedAt {
                        Text(relativeAge(from: ISO8601DateFormatter().date(from: startedAt)))
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                    if let reason = self.run.terminationReason, !reason.isEmpty, reason != self.run.status {
                        Text(reason)
                            .font(.system(size: 9))
                            .foregroundStyle(.tertiary)
                    }
                }
            }
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
    }

    private var durationLabel: String? {
        let formatter = ISO8601DateFormatter()
        guard let startStr = self.run.startedAt, let finishStr = self.run.finishedAt,
              let start = formatter.date(from: startStr),
              let finish = formatter.date(from: finishStr) else { return nil }
        let seconds = Int(finish.timeIntervalSince(start))
        let minutes = seconds / 60
        let secs = seconds % 60
        if minutes > 0 {
            return "\(minutes)m \(secs)s"
        }
        return "\(secs)s"
    }

    private static func statusIcon(_ status: String) -> String {
        switch status {
        case "succeeded": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "slash.circle.fill"
        case "running": "circle.dotted.circle"
        case "queued": "clock"
        default: "circle.fill"
        }
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "succeeded": .green
        case "failed": .red
        case "cancelled": .orange
        case "running": .blue
        case "queued": .secondary
        default: .secondary
        }
    }

    private static func statusLabel(_ status: String) -> String {
        status.replacingOccurrences(of: "_", with: " ").capitalized
    }
}

private struct CockpitFinishedLanePicker: View {
    @Bindable var store: CockpitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            Text("Workers")
                .font(.caption.weight(.semibold))
                .foregroundStyle(.secondary)
                .padding(.horizontal, 10)
                .padding(.vertical, 6)

            ScrollView {
                VStack(alignment: .leading, spacing: 0) {
                    ForEach(self.store.snapshot?.finishedLanes ?? []) { lane in
                        Button {
                            Task { await self.store.selectFinishedWorker(lane.workerId) }
                        } label: {
                            VStack(alignment: .leading, spacing: 4) {
                                HStack(spacing: 6) {
                                    Image(systemName: Self.statusIcon(lane.status))
                                        .font(.caption2)
                                        .foregroundStyle(Self.statusColor(lane.status))
                                    Text(lane.workerName)
                                        .font(.caption.weight(.medium))
                                        .lineLimit(1)
                                    Spacer()
                                    Text(relativeAge(from: ISO8601DateFormatter().date(from: lane.updatedAt)))
                                        .font(.system(size: 9))
                                        .foregroundStyle(.tertiary)
                                }
                                Text(lane.taskTitle)
                                    .font(.system(size: 10))
                                    .foregroundStyle(.secondary)
                                    .lineLimit(1)
                                if let branch = lane.branch {
                                    Text(branch)
                                        .font(.system(size: 9, design: .monospaced))
                                        .foregroundStyle(.tertiary)
                                        .lineLimit(1)
                                }
                                if let run = lane.latestRun, let summary = run.summary, !summary.isEmpty {
                                    Text(summary)
                                        .font(.system(size: 10))
                                        .foregroundStyle(.secondary)
                                        .lineLimit(2)
                                }
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 6)
                            .frame(maxWidth: .infinity, alignment: .leading)
                            .background(
                                self.store.selectedFinishedWorkerId == lane.workerId
                                    ? Color.accentColor.opacity(0.12) : Color.clear)
                            .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                        }
                        .buttonStyle(.plain)
                    }
                }
            }
        }
        .frame(maxHeight: .infinity)
    }

    private static func statusIcon(_ status: String) -> String {
        switch status {
        case "completed": "checkmark.circle.fill"
        case "failed": "xmark.circle.fill"
        case "cancelled": "slash.circle.fill"
        default: "circle.fill"
        }
    }

    private static func statusColor(_ status: String) -> Color {
        switch status {
        case "completed": .green
        case "failed": .red
        case "cancelled": .orange
        default: .secondary
        }
    }
}

private struct CockpitTasksSection: View {
    let tasks: [CockpitTaskSummary]

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Recent Tasks")
                .font(.title3.weight(.semibold))
            if self.tasks.isEmpty {
                sectionPlaceholder("No tasks recorded yet.")
            } else {
                VStack(alignment: .leading, spacing: 8) {
                    ForEach(self.tasks.prefix(6)) { task in
                        HStack(alignment: .top) {
                            VStack(alignment: .leading, spacing: 4) {
                                Text(task.title)
                                    .font(.headline)
                                Text(task.status.replacingOccurrences(of: "_", with: " "))
                                    .font(.caption)
                                    .foregroundStyle(.secondary)
                            }
                            Spacer()
                            Text(relativeAge(from: ISO8601DateFormatter().date(from: task.updatedAt)))
                                .font(.caption2)
                                .foregroundStyle(.secondary)
                        }
                    }
                }
                .padding(14)
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(Color.primary.opacity(0.04)))
            }
        }
    }
}

private func sectionPlaceholder(_ message: String) -> some View {
    Text(message)
        .font(.callout)
        .foregroundStyle(.secondary)
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color.primary.opacity(0.04)))
}
