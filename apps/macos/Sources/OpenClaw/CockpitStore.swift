import Foundation
import Observation
import OSLog

typealias CockpitSummaryLoader = @Sendable () async throws -> CockpitWorkspaceSummary
typealias CockpitGatewayStatusLoader = @Sendable () async throws -> CockpitGatewayStatus
typealias CockpitWorkerLogsLoader = @Sendable (_ workerId: String) async throws -> CockpitWorkerLogs
typealias CockpitWorkerDiffLoader = @Sendable (_ workerId: String) async throws -> CockpitWorkerDiff
typealias CockpitReviewResolver = @Sendable (_ reviewId: String, _ status: String) async throws -> CockpitReviewResolution
typealias CockpitSupervisorTickPerformer = @Sendable (_ repoRoot: String?) async throws -> CockpitSupervisorTickResult
typealias CockpitWorkerActionPerformer = @Sendable (_ action: CockpitWorkerAction, _ workerId: String) async throws -> Void
typealias CockpitWorkerDetailLoader = @Sendable (_ workerId: String) async throws -> CockpitWorkerDetail
typealias CockpitRemoteReconnectAction = @Sendable () async throws -> Void

enum CockpitLoadError: LocalizedError {
    case gatewayUnavailable(String)

    var errorDescription: String? {
        switch self {
        case let .gatewayUnavailable(reason):
            "Could not load cockpit state from the gateway: \(reason)"
        }
    }
}

@MainActor
@Observable
final class CockpitStore {
    static let shared = CockpitStore()

    static var preview: CockpitStore {
        let store = CockpitStore(isPreview: true)
        store.snapshot = .preview
        store.gatewayStatus = .previewLocal
        store.selectedWorkerId = CockpitWorkspaceSummary.preview.activeLanes.first?.workerId
        if let workerId = store.selectedWorkerId {
            store.selectedWorkerLogs = .preview(workerId: workerId)
            store.selectedWorkerDiff = .preview(workerId: workerId)
        }
        store.selectedFinishedWorkerId = CockpitWorkspaceSummary.preview.finishedLanes.first?.workerId
        if let finishedId = store.selectedFinishedWorkerId {
            store.finishedWorkerDetail = .preview(workerId: finishedId)
            store.finishedWorkerDiff = .preview(workerId: finishedId)
            store.finishedWorkerLogs = .preview(workerId: finishedId)
        }
        return store
    }

    var snapshot: CockpitWorkspaceSummary?
    var gatewayStatus: CockpitGatewayStatus?
    var isLoading = false
    var lastError: String?
    var selectedWorkerId: String?
    var selectedWorkerLogs: CockpitWorkerLogs?
    var selectedWorkerDiff: CockpitWorkerDiff?
    var isLoadingWorkerLogs = false
    var isLoadingWorkerDiff = false
    var selectedFinishedWorkerId: String?
    var finishedWorkerDiff: CockpitWorkerDiff?
    var finishedWorkerLogs: CockpitWorkerLogs?
    var finishedWorkerDetail: CockpitWorkerDetail?
    var isLoadingFinishedDiff = false
    var isLoadingFinishedLogs = false
    var isLoadingFinishedDetail = false
    var isStartingNextWorker = false
    var isPerformingWorkerAction = false
    var isResolvingReview = false
    var activeWorkerAction: CockpitWorkerAction?
    var isRepairingRemoteConnection = false

    private let logger = Logger(subsystem: "ai.openclaw", category: "cockpit.ui")
    private let isPreview: Bool
    private let loadGatewayStatus: CockpitGatewayStatusLoader
    private let loadSummary: CockpitSummaryLoader
    private let loadWorkerLogs: CockpitWorkerLogsLoader
    private let loadWorkerDiff: CockpitWorkerDiffLoader
    private let resolveReviewImpl: CockpitReviewResolver
    private let performSupervisorTickImpl: CockpitSupervisorTickPerformer
    private let performWorkerActionImpl: CockpitWorkerActionPerformer
    private let loadWorkerDetail: CockpitWorkerDetailLoader
    private let reconnectRemoteGatewayImpl: CockpitRemoteReconnectAction

    var selectedLane: CockpitLaneSummary? {
        guard let snapshot = self.snapshot else { return nil }
        guard let selectedWorkerId = self.selectedWorkerId else {
            return snapshot.activeLanes.first
        }
        return snapshot.activeLanes.first(where: { $0.workerId == selectedWorkerId }) ?? snapshot.activeLanes.first
    }

    var projectRootLabel: String? {
        Self.resolveProjectRoot(snapshot: self.snapshot, selectedLane: self.selectedLane)
    }

    var canStartNextWorker: Bool {
        self.projectRootLabel != nil && self.gatewayStatus?.state == .ready
    }

    var selectedFinishedLane: CockpitLaneSummary? {
        guard let snapshot = self.snapshot else { return nil }
        guard let selectedFinishedWorkerId = self.selectedFinishedWorkerId else {
            return snapshot.finishedLanes.first
        }
        return snapshot.finishedLanes.first(where: { $0.workerId == selectedFinishedWorkerId })
            ?? snapshot.finishedLanes.first
    }

    var selectedLaneNeedsReview: Bool {
        guard let lane = self.selectedLane else { return false }
        let reviewStatuses: Set<String> = ["awaiting_review", "completed", "awaiting_approval"]
        return reviewStatuses.contains(lane.status) || lane.pendingReview != nil
    }

    init(
        isPreview: Bool = ProcessInfo.processInfo.isPreview,
        loadGatewayStatus: CockpitGatewayStatusLoader? = nil,
        loadSummary: CockpitSummaryLoader? = nil,
        loadWorkerLogs: CockpitWorkerLogsLoader? = nil,
        loadWorkerDiff: CockpitWorkerDiffLoader? = nil,
        loadWorkerDetail: CockpitWorkerDetailLoader? = nil,
        resolveReview: CockpitReviewResolver? = nil,
        performSupervisorTick: CockpitSupervisorTickPerformer? = nil,
        performWorkerAction: CockpitWorkerActionPerformer? = nil,
        reconnectRemoteGateway: CockpitRemoteReconnectAction? = nil)
    {
        self.isPreview = isPreview
        self.loadGatewayStatus = loadGatewayStatus ?? {
            await GatewayEndpointStore.shared.refresh()
            let state = await GatewayEndpointStore.shared.currentState()
            return CockpitGatewayStatus.from(endpointState: state)
        }
        self.loadSummary = loadSummary ?? {
            try await GatewayConnection.shared.codeCockpitSummary()
        }
        self.loadWorkerLogs = loadWorkerLogs ?? { workerId in
            try await GatewayConnection.shared.codeWorkerLogs(workerId: workerId)
        }
        self.loadWorkerDiff = loadWorkerDiff ?? { workerId in
            try await GatewayConnection.shared.codeWorkerDiff(workerId: workerId)
        }
        self.loadWorkerDetail = loadWorkerDetail ?? { workerId in
            try await GatewayConnection.shared.codeWorkerShow(workerId: workerId)
        }
        self.resolveReviewImpl = resolveReview ?? { reviewId, status in
            try await GatewayConnection.shared.codeReviewStatus(reviewId: reviewId, status: status)
        }
        self.performSupervisorTickImpl = performSupervisorTick ?? { repoRoot in
            try await GatewayConnection.shared.codeSupervisorTick(repoRoot: repoRoot)
        }
        self.performWorkerActionImpl = performWorkerAction ?? { action, workerId in
            switch action {
            case .start:
                try await GatewayConnection.shared.codeWorkerStart(workerId: workerId)
            case .pause:
                try await GatewayConnection.shared.codeWorkerPause(workerId: workerId)
            case .resume:
                try await GatewayConnection.shared.codeWorkerResume(workerId: workerId)
            case .cancel:
                try await GatewayConnection.shared.codeWorkerCancel(workerId: workerId)
            }
        }
        self.reconnectRemoteGatewayImpl = reconnectRemoteGateway ?? {
            _ = try await GatewayEndpointStore.shared.ensureRemoteControlTunnel()
            await GatewayEndpointStore.shared.refresh()
        }
    }

    func startNextWorker() async {
        guard !self.isStartingNextWorker else { return }
        guard self.canStartNextWorker else { return }

        self.isStartingNextWorker = true
        self.lastError = nil
        defer { self.isStartingNextWorker = false }

        do {
            let result = try await self.performSupervisorTickImpl(self.projectRootLabel)
            if let workerId = result.worker?.id {
                self.selectedWorkerId = workerId
            }
            await self.refresh()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit supervisor tick failed \(message, privacy: .public)")
            self.lastError = message
        }
    }

    func refreshIfNeeded() async {
        guard self.snapshot == nil else { return }
        await self.refresh()
    }

    func refresh() async {
        guard !self.isLoading else { return }
        if self.isPreview {
            self.snapshot = self.snapshot ?? .preview
            self.gatewayStatus = self.gatewayStatus ?? .previewLocal
            self.reconcileSelection()
            if let workerId = self.selectedWorkerId {
                if self.selectedWorkerLogs == nil {
                    self.selectedWorkerLogs = .preview(workerId: workerId)
                }
                if self.selectedWorkerDiff == nil {
                    self.selectedWorkerDiff = .preview(workerId: workerId)
                }
            }
            if let finishedId = self.selectedFinishedWorkerId {
                if self.finishedWorkerDetail == nil {
                    self.finishedWorkerDetail = .preview(workerId: finishedId)
                }
                if self.finishedWorkerDiff == nil {
                    self.finishedWorkerDiff = .preview(workerId: finishedId)
                }
                if self.finishedWorkerLogs == nil {
                    self.finishedWorkerLogs = .preview(workerId: finishedId)
                }
            }
            return
        }

        self.isLoading = true
        self.lastError = nil
        defer { self.isLoading = false }

        do {
            self.gatewayStatus = try await self.loadGatewayStatus()
            self.snapshot = try await self.loadSummary()
            self.reconcileSelection()
            await self.refreshSelectedWorkerLogs()
            await self.refreshSelectedWorkerDiff()
            await self.refreshFinishedWorkerDetail()
            await self.refreshFinishedWorkerDiff()
            await self.refreshFinishedWorkerLogs()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit summary failed \(message, privacy: .public)")
            self.lastError = CockpitLoadError.gatewayUnavailable(message).localizedDescription
        }
    }

    func reconnectRemoteGateway() async {
        guard !self.isRepairingRemoteConnection else { return }
        self.isRepairingRemoteConnection = true
        self.lastError = nil
        defer { self.isRepairingRemoteConnection = false }

        do {
            try await self.reconnectRemoteGatewayImpl()
            await self.refresh()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit remote reconnect failed \(message, privacy: .public)")
            self.lastError = message
        }
    }

    func selectWorker(_ workerId: String) async {
        self.selectedWorkerId = workerId
        await self.refreshSelectedWorkerLogs()
        await self.refreshSelectedWorkerDiff()
    }

    func loadDiffForSelectedWorker() async {
        await self.refreshSelectedWorkerDiff()
    }

    func selectFinishedWorker(_ workerId: String) async {
        self.selectedFinishedWorkerId = workerId
        await self.refreshFinishedWorkerDetail()
        await self.refreshFinishedWorkerDiff()
        await self.refreshFinishedWorkerLogs()
    }

    func reloadFinishedWorkerDiff() async {
        await self.refreshFinishedWorkerDiff()
    }

    func resolveReview(_ action: CockpitReviewAction, reviewId: String) async {
        guard !self.isResolvingReview else { return }
        self.isResolvingReview = true
        self.lastError = nil
        defer { self.isResolvingReview = false }

        do {
            _ = try await self.resolveReviewImpl(reviewId, action.apiStatus)
            await self.refresh()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit review resolve failed \(message, privacy: .public)")
            self.lastError = message
        }
    }

    func performWorkerAction(_ action: CockpitWorkerAction, workerId: String) async {
        guard !self.isPerformingWorkerAction else { return }
        self.isPerformingWorkerAction = true
        self.activeWorkerAction = action
        self.lastError = nil
        defer {
            self.isPerformingWorkerAction = false
            self.activeWorkerAction = nil
        }

        do {
            try await self.performWorkerActionImpl(action, workerId)
            await self.refresh()
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit worker action failed \(message, privacy: .public)")
            self.lastError = message
        }
    }

    private static func resolveProjectRoot(
        snapshot: CockpitWorkspaceSummary?,
        selectedLane: CockpitLaneSummary?) -> String?
    {
        if let repoRoot = self.normalizeProjectRoot(selectedLane?.repoRoot) {
            return repoRoot
        }
        if let snapshot {
            for lane in snapshot.activeLanes {
                if let repoRoot = self.normalizeProjectRoot(lane.repoRoot) {
                    return repoRoot
                }
            }
            for task in snapshot.recentTasks {
                if let repoRoot = self.normalizeProjectRoot(task.repoRoot) {
                    return repoRoot
                }
            }
            for worker in snapshot.recentWorkers {
                if let repoRoot = self.normalizeProjectRoot(worker.repoRoot) {
                    return repoRoot
                }
            }
        }

        let connection = CommandResolver.connectionSettings()
        if connection.mode == .remote {
            return self.normalizeProjectRoot(connection.projectRoot)
        }
        return self.normalizeProjectRoot(CommandResolver.projectRootPath())
    }

    private static func normalizeProjectRoot(_ value: String?) -> String? {
        let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return trimmed.isEmpty ? nil : trimmed
    }

    private func refreshFinishedWorkerDetail() async {
        guard let workerId = self.selectedFinishedWorkerId else {
            self.finishedWorkerDetail = nil
            return
        }
        if self.isPreview {
            self.finishedWorkerDetail = CockpitWorkerDetail.preview(workerId: workerId)
            return
        }

        self.isLoadingFinishedDetail = true
        defer { self.isLoadingFinishedDetail = false }

        do {
            self.finishedWorkerDetail = try await self.loadWorkerDetail(workerId)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit finished worker detail failed \(message, privacy: .public)")
        }
    }

    private func refreshFinishedWorkerDiff() async {
        guard let workerId = self.selectedFinishedWorkerId else {
            self.finishedWorkerDiff = nil
            return
        }
        if self.isPreview {
            self.finishedWorkerDiff = .preview(workerId: workerId)
            return
        }

        self.isLoadingFinishedDiff = true
        defer { self.isLoadingFinishedDiff = false }

        do {
            self.finishedWorkerDiff = try await self.loadWorkerDiff(workerId)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit finished worker diff failed \(message, privacy: .public)")
        }
    }

    private func refreshFinishedWorkerLogs() async {
        guard let workerId = self.selectedFinishedWorkerId else {
            self.finishedWorkerLogs = nil
            return
        }
        if self.isPreview {
            self.finishedWorkerLogs = .preview(workerId: workerId)
            return
        }

        self.isLoadingFinishedLogs = true
        defer { self.isLoadingFinishedLogs = false }

        do {
            self.finishedWorkerLogs = try await self.loadWorkerLogs(workerId)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit finished worker logs failed \(message, privacy: .public)")
        }
    }

    private func refreshSelectedWorkerDiff() async {
        guard let workerId = self.selectedWorkerId else {
            self.selectedWorkerDiff = nil
            return
        }
        if self.isPreview {
            self.selectedWorkerDiff = .preview(workerId: workerId)
            return
        }

        self.isLoadingWorkerDiff = true
        defer { self.isLoadingWorkerDiff = false }

        do {
            self.selectedWorkerDiff = try await self.loadWorkerDiff(workerId)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit worker diff failed \(message, privacy: .public)")
            // Don't set lastError for diff failures - non-critical
        }
    }

    private func reconcileSelection() {
        guard let snapshot = self.snapshot else {
            self.selectedWorkerId = nil
            self.selectedWorkerLogs = nil
            self.selectedWorkerDiff = nil
            self.selectedFinishedWorkerId = nil
            self.finishedWorkerDiff = nil
            self.finishedWorkerLogs = nil
            self.finishedWorkerDetail = nil
            return
        }
        if let selectedWorkerId = self.selectedWorkerId,
           snapshot.activeLanes.contains(where: { $0.workerId == selectedWorkerId })
        {
            // keep current active selection
        } else {
            self.selectedWorkerId = snapshot.activeLanes.first?.workerId
        }
        if let selectedFinishedWorkerId = self.selectedFinishedWorkerId,
           snapshot.finishedLanes.contains(where: { $0.workerId == selectedFinishedWorkerId })
        {
            // keep current finished selection
        } else {
            self.selectedFinishedWorkerId = snapshot.finishedLanes.first?.workerId
        }
    }

    private func refreshSelectedWorkerLogs() async {
        guard let workerId = self.selectedWorkerId else {
            self.selectedWorkerLogs = nil
            return
        }
        if self.isPreview {
            self.selectedWorkerLogs = .preview(workerId: workerId)
            return
        }

        self.isLoadingWorkerLogs = true
        defer { self.isLoadingWorkerLogs = false }

        do {
            self.selectedWorkerLogs = try await self.loadWorkerLogs(workerId)
        } catch {
            let message = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            self.logger.error("code cockpit worker logs failed \(message, privacy: .public)")
            self.lastError = message
        }
    }
}
