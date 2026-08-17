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

                        HStack(alignment: .center, spacing: 4) {
                            Text("Layout")
                                .font(.caption)
                                .foregroundStyle(.secondary)
                            Picker("", selection: self.$store.layoutPreset) {
                                ForEach(CockpitLayoutPreset.allCases) { preset in
                                    Text(preset.label).tag(preset)
                                }
                            }
                            .pickerStyle(.menu)
                            .fixedSize()
                        }

                        CockpitLayoutGrid(store: self.store)

                        CockpitSelectedWorkerSection(store: self.store)

                        HStack(alignment: .top, spacing: 16) {
                            CockpitRunsSection(runs: snapshot.recentRuns)
                        }
                        CockpitTasksSection(tasks: snapshot.recentTasks)
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

/// Renders the structured layout grid: worker slots across the top row, review slot at the end.
private struct CockpitLayoutGrid: View {
    @Bindable var store: CockpitStore

    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("Lanes")
                .font(.title3.weight(.semibold))

            let workerSlots = self.store.workerSlots
            let reviewSlot = self.store.reviewSlot

            HStack(alignment: .top, spacing: 12) {
                ForEach(Array(workerSlots.enumerated()), id: \.offset) { index, lane in
                    if let lane {
                        CockpitLaneCard(
                            lane: lane,
                            isSelected: self.store.selectedWorkerId == lane.workerId,
                            onSelect: { Task { await self.store.selectWorker(lane.workerId) } })
                    } else {
                        CockpitEmptySlotCard(label: "Worker \(index + 1)", hint: "Start a worker to fill this slot.")
                    }
                }

                if self.store.layoutPreset.hasReviewSlot {
                    if let lane = reviewSlot {
                        CockpitLaneCard(
                            lane: lane,
                            isSelected: self.store.selectedWorkerId == lane.workerId,
                            onSelect: { Task { await self.store.selectWorker(lane.workerId) } },
                            accentColor: .orange)
                    } else {
                        CockpitEmptySlotCard(label: "Review", hint: "Pending reviews appear here.")
                    }
                }
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }
}

private struct CockpitLaneCard: View {
    let lane: CockpitLaneSummary
    let isSelected: Bool
    let onSelect: () -> Void
    var accentColor: Color = .accentColor

    var body: some View {
        Button(action: self.onSelect) {
            VStack(alignment: .leading, spacing: 8) {
                HStack {
                    Text(self.lane.workerName)
                        .font(.headline)
                    Spacer()
                    Text(self.lane.status.replacingOccurrences(of: "_", with: " "))
                        .font(.caption.weight(.medium))
                        .foregroundStyle(.secondary)
                }
                Text(self.lane.taskTitle)
                    .font(.subheadline)
                    .multilineTextAlignment(.leading)
                if let branch = self.lane.branch {
                    Text(branch)
                        .font(.caption.monospaced())
                        .foregroundStyle(.secondary)
                }
                if let summary = self.lane.latestRun?.summary, !summary.isEmpty {
                    Text(summary)
                        .font(.caption)
                        .foregroundStyle(.secondary)
                        .multilineTextAlignment(.leading)
                }
                if let review = self.lane.pendingReview {
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
                    .fill(self.isSelected ? self.accentColor.opacity(0.14) : Color.primary.opacity(0.04)))
        }
        .buttonStyle(.plain)
    }
}

private struct CockpitEmptySlotCard: View {
    let label: String
    let hint: String

    var body: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(self.label)
                .font(.headline)
                .foregroundStyle(.tertiary)
            Text(self.hint)
                .font(.caption)
                .foregroundStyle(.quaternary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .strokeBorder(Color.primary.opacity(0.08), style: StrokeStyle(lineWidth: 1, dash: [6, 4])))
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
