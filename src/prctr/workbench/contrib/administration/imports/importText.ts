/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import type {
	importModes,
	importStates
} from '../../../../platform/administration/common/administrationProtocol.js';
import type { AdministrationText } from '../administrationFormat.js';

type Mode = (typeof importModes)[number];
type State = (typeof importStates)[number];

export const IMPORT_STATE_TEXT: Readonly<Record<State, AdministrationText>> = {
	uploading: 'importStateUploading',
	parsing: 'importStateParsing',
	preview_ready: 'importStateReady',
	executing: 'importStateExecuting',
	completed: 'importStateCompleted',
	completed_with_errors: 'importStateCompletedWithErrors',
	canceled: 'importStateCanceled',
	failed: 'importStateFailed'
};

export const IMPORT_MODE_TEXT: Readonly<Record<Mode | 'student_progression', AdministrationText>> =
	{
		student_class: 'importsModeStudents',
		teacher_academic_unit: 'importsModeTeachers',
		institution: 'importsModeInstitution',
		academic_administration: 'importsModeAdministration',
		student_progression: 'importsModeProgression'
	};
