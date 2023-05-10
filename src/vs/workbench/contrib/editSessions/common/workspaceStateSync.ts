/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken, CancellationTokenSource } from 'vs/base/common/cancellation';
import { IStringDictionary } from 'vs/base/common/collections';
import { parse, stringify } from 'vs/base/common/marshalling';
import { URI } from 'vs/base/common/uri';
import { IConfigurationService } from 'vs/platform/configuration/common/configuration';
import { IEnvironmentService } from 'vs/platform/environment/common/environment';
import { IFileService } from 'vs/platform/files/common/files';
import { IStorageService, StorageScope, StorageTarget } from 'vs/platform/storage/common/storage';
import { ITelemetryService } from 'vs/platform/telemetry/common/telemetry';
import { IUriIdentityService } from 'vs/platform/uriIdentity/common/uriIdentity';
import { IUserDataProfile } from 'vs/platform/userDataProfile/common/userDataProfile';
import { AbstractSynchroniser, IAcceptResult, IMergeResult, IResourcePreview } from 'vs/platform/userDataSync/common/abstractSynchronizer';
import { IRemoteUserData, IUserDataSyncBackupStoreService, IUserDataSyncConfiguration, IUserDataSyncEnablementService, IUserDataSyncLogService, IUserDataSyncStoreService, IUserDataSynchroniser, IWorkspaceState, SyncResource } from 'vs/platform/userDataSync/common/userDataSync';
import { IEditSessionsStorageService } from 'vs/workbench/contrib/editSessions/common/editSessions';
import { IWorkspaceIdentityService } from 'vs/workbench/services/workspaces/common/workspaceIdentityService';

export class WorkspaceStateSynchroniser extends AbstractSynchroniser implements IUserDataSynchroniser {
	protected override version: number = 1;

	constructor(
		profile: IUserDataProfile,
		collection: string | undefined,
		@IFileService fileService: IFileService,
		@IUserDataSyncStoreService userDataSyncStoreService: IUserDataSyncStoreService, // TODO@joyceerhl Pass in the Edit Sessions instances instead?
		@IUserDataSyncBackupStoreService userDataSyncBackupStoreService: IUserDataSyncBackupStoreService, // TODO@joyceerhl Pass in the Edit Sessions instances instead?
		@IUserDataSyncLogService logService: IUserDataSyncLogService, // TODO@joyceerhl Pass in the Edit Sessions instances instead?
		@IEnvironmentService environmentService: IEnvironmentService,
		@IUserDataSyncEnablementService userDataSyncEnablementService: IUserDataSyncEnablementService,
		@ITelemetryService telemetryService: ITelemetryService,
		@IConfigurationService configurationService: IConfigurationService,
		@IStorageService storageService: IStorageService,
		@IUriIdentityService uriIdentityService: IUriIdentityService,
		@IWorkspaceIdentityService private readonly workspaceIdentityService: IWorkspaceIdentityService,
		@IEditSessionsStorageService private readonly editSessionsStorageService: IEditSessionsStorageService,
	) {
		super({ syncResource: SyncResource.WorkspaceState, profile }, collection, fileService, environmentService, storageService, userDataSyncStoreService, userDataSyncBackupStoreService, userDataSyncEnablementService, telemetryService, logService, configurationService, uriIdentityService);
	}

	override async sync(): Promise<void> {
		const cancellationTokenSource = new CancellationTokenSource();
		const folders = await this.workspaceIdentityService.getWorkspaceStateFolders(cancellationTokenSource.token);
		if (!folders.length) {
			return;
		}

		const contributedData: IStringDictionary<string> = {};
		this.storageService.keys(StorageScope.WORKSPACE, StorageTarget.USER).forEach((key) => {
			const data = this.storageService.get(key, StorageScope.WORKSPACE);
			if (data) {
				contributedData[key] = data;
			}
		});

		const content: IWorkspaceState = { folders, storage: contributedData };
		this.editSessionsStorageService.write('workspaceState', stringify(content));
	}

	protected override async applyResult(remoteUserData: IRemoteUserData): Promise<void> {
		const cancellationTokenSource = new CancellationTokenSource();
		const remoteWorkspaceState: IWorkspaceState = remoteUserData.syncData ? JSON.parse(remoteUserData.syncData.content) : null;
		if (!remoteWorkspaceState) {
			this.logService.info('Skipping initializing workspace state because remote workspace state does not exist.');
			return;
		}

		const storage: IStringDictionary<any> = {};
		for (const key of Object.keys(remoteWorkspaceState.storage)) {
			storage[key] = remoteWorkspaceState.storage[key];
		}

		if (Object.keys(storage).length) {
			// Evaluate whether storage is applicable for current workspace
			const replaceUris = await this.workspaceIdentityService.matches(remoteWorkspaceState.folders, cancellationTokenSource.token);
			// If so, initialize storage with remote storage
			for (const key of Object.keys(storage)) {
				// Deserialize the stored state
				let value = parse(storage[key]);
				// Run URI conversion on the stored state
				value = replaceUris(value);
				// Write the stored state to the storage service
				this.storageService.store(key, value, StorageScope.WORKSPACE, StorageTarget.USER);
			}
		}
	}

	protected override async generateSyncPreview(remoteUserData: IRemoteUserData, lastSyncUserData: IRemoteUserData | null, isRemoteDataFromCurrentMachine: boolean, userDataSyncConfiguration: IUserDataSyncConfiguration, token: CancellationToken): Promise<IResourcePreview[]> {
		return [];
	}
	protected override getMergeResult(resourcePreview: IResourcePreview, token: CancellationToken): Promise<IMergeResult> {
		throw new Error('Method not implemented.');
	}
	protected override getAcceptResult(resourcePreview: IResourcePreview, resource: URI, content: string | null | undefined, token: CancellationToken): Promise<IAcceptResult> {
		throw new Error('Method not implemented.');
	}
	protected override async hasRemoteChanged(lastSyncUserData: IRemoteUserData): Promise<boolean> {
		return true;
	}
	override async hasLocalData(): Promise<boolean> {
		return false;
	}
	override async resolveContent(uri: URI): Promise<string | null> {
		return null;
	}
}
