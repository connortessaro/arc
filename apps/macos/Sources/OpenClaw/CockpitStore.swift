import Foundation
import Observation
import OSLog

typealias CockpitSummaryLoader = @Sendable () async throws -> CockpitWorkspaceSummary
typealias CockpitGatewayStatusLoader = @Sendable () async throws -> CockpitGatewayStatus
typealias CockpitWorkerLogsLoader = @Sendable (_ workerId: String) async throws -> CockpitWorkerLogs
typealias CockpitSupervisorTickPerformer = @Sendable (_ repoRoot: String?) async throws -> CockpitSupervisorTickResult
typealias CockpitWorkerActionPerformer = @Sendable (_ action: CockpitWorkerAction, _ workerId: String) async throws -> Void
typealias CockpitReviewResolvePerformer = @Sendable (_ reviewId: String, _ status: String) async throws -> Void
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
        }
        return store
    }

    var snapshot: CockpitWorkspaceSummary?
    var gatewayStatus: CockpitGatewayStatus?
    var isLoading = false
    var lastError: String?
    var selectedWorkerId: String?
    var selectedWorkerLogs: CockpitWorkerLogs?
    var isLoadingWorkerLogs = false
    var isStartingNextWorker = false
    var isPerformingWorkerAction = false
    var activeWorkerAction: CockpitWorkerAction?
    var isRepairingRemoteConnection = false
    var isResolvingReview = false

    private let logger = Logger(subsystem: "ai.openclaw", category: "cockpit.ui")
    private let isPreview: Bool
    private let loadGatewayStatus: CockpitGatewayStatusLoader
    private let loadSummary: CockpitSummaryLoader
    private let loadWorkerLogs: CockpitWorkerLogsLoader
    private let performSupervisorTickImpl: CockpitSupervisorTickPerformer
    private let performWorkerActionImpl: CockpitWorkerActionPerformer
    private let resolveReviewImpl: CockpitReviewResolvePerformer
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

    init(
        isPreview: Bool = ProcessInfo.processInfo.isPreview,
        loadGatewayStatus: CockpitGatewayStatusLoader? = nil,
        loadSummary: CockpitSummaryLoader? = nil,
        loadWorkerLogs: CockpitWorkerLogsLoader? = nil,
        performSupervisorTick: CockpitSupervisorTickPerformer? = nil,
        performWorkerAction: CockpitWorkerActionPerformer? = nil,
        resolveReview: CockpitReviewResolvePerformer? = nil,
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
        self.resolveReviewImpl = resolveReview ?? { reviewId, status in
            try await GatewayConnection.shared.codeReviewResolve(reviewId: reviewId, status: status)
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
            if let workerId = self.selectedWorkerId, self.selectedWorkerLogs == nil {
                self.selectedWorkerLogs = .preview(workerId: workerId)
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
    }

    func resolveReview(reviewId: String, status: String) async {
        guard !self.isResolvingReview else { return }
        self.isResolvingReview = true
        self.lastError = nil
        defer { self.isResolvingReview = false }

        do {
            try await self.resolveReviewImpl(reviewId, status)
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

    private func reconcileSelection() {
        guard let snapshot = self.snapshot else {
            self.selectedWorkerId = nil
            self.selectedWorkerLogs = nil
            return
        }
        if let selectedWorkerId = self.selectedWorkerId,
           snapshot.activeLanes.contains(where: { $0.workerId == selectedWorkerId })
        {
            return
        }
        self.selectedWorkerId = snapshot.activeLanes.first?.workerId
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
