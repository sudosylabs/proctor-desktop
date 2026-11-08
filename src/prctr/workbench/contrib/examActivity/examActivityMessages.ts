import { defineMessage } from '../../../base/common/localization.js';

export const examActivityMessages = {
	upcomingDescription: defineMessage({
		id: 'exams.description.upcoming',
		defaultMessage: 'Plan ahead for your scheduled exams.',
		description: 'Upcoming activity description.'
	}),
	availableDescription: defineMessage({
		id: 'exams.description.available',
		defaultMessage: 'Exams currently open for entry.',
		description: 'Available activity description.'
	}),
	in_progressDescription: defineMessage({
		id: 'exams.description.progress',
		defaultMessage: 'Your unfinished attempts and their current status.',
		description: 'In progress activity description.'
	}),
	submittedDescription: defineMessage({
		id: 'exams.description.submitted',
		defaultMessage: 'Exams with a recorded submission.',
		description: 'Submitted activity description.'
	}),
	results_availableDescription: defineMessage({
		id: 'exams.description.results',
		defaultMessage: 'Read the results released to you.',
		description: 'Released results description.'
	}),
	pastDescription: defineMessage({
		id: 'exams.description.history',
		defaultMessage: 'Find your earlier exam activity.',
		description: 'Past activity description.'
	}),
	partialEmpty: defineMessage({
		id: 'exams.filter.partial.empty',
		defaultMessage: 'No matching exams loaded yet.',
		description: 'An incomplete collection cannot establish an empty category.'
	}),
	overview: defineMessage({
		id: 'exams.overview',
		defaultMessage: 'Your exams, at a glance',
		description: 'Student overview introduction.'
	}),
	openExam: defineMessage({
		id: 'exams.open.details',
		defaultMessage: 'View exam',
		description: 'Inspect exam details before admission.'
	}),
	upcomingSection: defineMessage({
		id: 'exams.section.upcoming',
		defaultMessage: 'Coming up',
		description: 'Scheduled exams heading.'
	}),
	actionSection: defineMessage({
		id: 'exams.section.action',
		defaultMessage: 'Available now',
		description: 'Currently available exams heading.'
	}),
	progressSection: defineMessage({
		id: 'exams.section.progress',
		defaultMessage: 'Continue your exam',
		description: 'Unfinished attempts heading.'
	}),
	recentSection: defineMessage({
		id: 'exams.section.recent',
		defaultMessage: 'Submissions & results',
		description: 'Completed activity heading.'
	}),
	historySection: defineMessage({
		id: 'exams.section.history',
		defaultMessage: 'Earlier exams',
		description: 'Past activity heading.'
	}),
	filteredEmpty: defineMessage({
		id: 'exams.filter.empty',
		defaultMessage: 'No exams in this section.',
		description: 'Empty loaded activity filter.'
	}),
	partial: defineMessage({
		id: 'exams.collection.partial',
		defaultMessage: 'More exams are available. Load more to include them in these sections.',
		description: 'Loaded subset is not the entire exam collection.'
	}),
	timezone: defineMessage({
		id: 'exams.schedule.timezone',
		defaultMessage: 'Times shown in {zone}',
		description: 'Time zone used for exam schedules.'
	}),
	closeDetails: defineMessage({
		id: 'exams.details.close',
		defaultMessage: 'Close exam details',
		description: 'Close the exam inspector and return to selection.'
	}),
	activity: defineMessage({
		id: 'exams.page.activity',
		defaultMessage: 'My exams',
		description: 'Own examination activity page.'
	}),
	management: defineMessage({
		id: 'exams.page.management',
		defaultMessage: 'Exam management',
		description: 'Authorized management area.'
	}),
	administration: defineMessage({
		id: 'exams.page.administration',
		defaultMessage: 'Administration',
		description: 'Authorized administration area.'
	}),
	subtitle: defineMessage({
		id: 'exams.page.subtitle',
		defaultMessage: 'Your scheduled exams, attempts and released results.',
		description: 'Purpose of student activity.'
	}),
	future: defineMessage({
		id: 'exams.page.future',
		defaultMessage: 'This area is not available in Proctor Desktop yet.',
		description: 'Honest state for management pages not implemented in this release.'
	}),
	scopes: defineMessage({
		id: 'exams.page.scopes',
		defaultMessage: 'Your management access',
		description: 'Server-projected management scope summary.'
	}),
	moreScopes: defineMessage({
		id: 'exams.page.scopes.more',
		defaultMessage: 'You also have access to other areas.',
		description: 'Bounded summary has more scopes.'
	}),
	loading: defineMessage({
		id: 'exams.state.loading',
		defaultMessage: 'Loading…',
		description: 'Pending server request.'
	}),
	empty: defineMessage({
		id: 'exams.state.empty',
		defaultMessage: 'No exams to show yet.',
		description: 'Successful empty exam activity response.'
	}),
	emptyDetail: defineMessage({
		id: 'exams.details.empty',
		defaultMessage: 'Select an exam to see its details.',
		description: 'Empty secondary side bar.'
	}),
	retry: defineMessage({
		id: 'exams.action.retry',
		defaultMessage: 'Retry',
		description: 'Retry a failed automatic data request.'
	}),
	refresh: defineMessage({
		id: 'exams.action.refresh',
		defaultMessage: 'Refresh',
		description: 'Read current access and restart exam activity pagination.'
	}),
	more: defineMessage({
		id: 'exams.action.more',
		defaultMessage: 'Load more',
		description: 'Read the next page of exam activity.'
	}),
	count: defineMessage({
		id: 'exams.page.count',
		defaultMessage: '{count} exams loaded',
		description: 'Count of loaded exams, not a total.'
	}),
	unavailable: defineMessage({
		id: 'exams.error.unavailable',
		defaultMessage: 'Could not load the latest information. Try refreshing.',
		description: 'Recoverable read failure.'
	}),
	restricted: defineMessage({
		id: 'exams.error.restricted',
		defaultMessage: 'You no longer have access to this area.',
		description: 'Server denied current access.'
	}),
	sessionEnded: defineMessage({
		id: 'exams.error.session.ended',
		defaultMessage: 'Your session has ended. Sign in again to continue.',
		description: 'Bound session is no longer valid.'
	}),
	notFound: defineMessage({
		id: 'exams.error.not.found',
		defaultMessage: 'This result is no longer available.',
		description: 'Released projection removed or no longer accessible.'
	}),
	invalidCursor: defineMessage({
		id: 'exams.error.cursor',
		defaultMessage: 'The list has changed. Refresh to load it again.',
		description: 'Server rejected stale pagination.'
	}),
	noAffiliation: defineMessage({
		id: 'exams.access.no.affiliation',
		defaultMessage: 'You have no current institution affiliation.',
		description: 'Server context has no current affiliation.'
	}),
	noAccess: defineMessage({
		id: 'exams.access.none',
		defaultMessage: 'No exam or management access is assigned to your account.',
		description: 'Server context has no assigned product access.'
	}),
	upcoming: defineMessage({
		id: 'exams.status.upcoming',
		defaultMessage: 'Upcoming',
		description: 'Upcoming exam.'
	}),
	available: defineMessage({
		id: 'exams.status.available',
		defaultMessage: 'Available',
		description: 'Available examination activity.'
	}),
	in_progress: defineMessage({
		id: 'exams.status.in.progress',
		defaultMessage: 'In progress',
		description: 'Unresolved attempt.'
	}),
	submitted: defineMessage({
		id: 'exams.status.submitted',
		defaultMessage: 'Submitted',
		description: 'Submission recorded.'
	}),
	results_available: defineMessage({
		id: 'exams.status.results.available',
		defaultMessage: 'Result available',
		description: 'Explicitly released candidate result.'
	}),
	past: defineMessage({
		id: 'exams.status.past',
		defaultMessage: 'Past',
		description: 'Past examination activity.'
	}),
	not_open: defineMessage({
		id: 'exams.access.not.open',
		defaultMessage: 'This exam is not open yet.',
		description: 'Exam cannot currently be entered.'
	}),
	joinable: defineMessage({
		id: 'exams.access.joinable',
		defaultMessage: 'This exam is open for entry.',
		description: 'Server currently permits an entry request.'
	}),
	resumable: defineMessage({
		id: 'exams.access.resumable',
		defaultMessage: 'Your attempt can be resumed.',
		description: 'Server currently permits a resume request.'
	}),
	sitting_paused: defineMessage({
		id: 'exams.access.paused',
		defaultMessage: 'This exam is paused. Wait for it to resume.',
		description: 'Sitting paused by authorized manager.'
	}),
	await_reallow: defineMessage({
		id: 'exams.access.reallow',
		defaultMessage: 'A manager needs to allow you to re-enter.',
		description: 'Suspended attempt requires reallow.'
	}),
	blocked_by_other_attempt: defineMessage({
		id: 'exams.access.other.attempt',
		defaultMessage: 'You have an unfinished attempt in another exam.',
		description: 'Different unresolved attempt blocks admission.'
	}),
	not_eligible: defineMessage({
		id: 'exams.access.ineligible',
		defaultMessage: 'You are not currently eligible to enter this exam.',
		description: 'Server eligibility restriction.'
	}),
	result_available: defineMessage({
		id: 'exams.access.result',
		defaultMessage: 'Your result has been released.',
		description: 'Explicit result release.'
	}),
	ended: defineMessage({
		id: 'exams.access.ended',
		defaultMessage: 'This exam has ended.',
		description: 'Sitting no longer admits candidates.'
	}),
	enter: defineMessage({
		id: 'exams.action.enter',
		defaultMessage: 'Enter exam',
		description: 'Admission action, unavailable until secure participation is composed.'
	}),
	resume: defineMessage({
		id: 'exams.action.resume',
		defaultMessage: 'Resume attempt',
		description: 'Resume action, unavailable until secure participation is composed.'
	}),
	view_result: defineMessage({
		id: 'exams.action.result',
		defaultMessage: 'View result',
		description: 'Read released candidate remarks.'
	}),
	admissionUnavailable: defineMessage({
		id: 'exams.admission.unavailable',
		defaultMessage: 'Taking exams is not available in this desktop build yet.',
		description: 'Production secure participation is not yet connected; never fake entry.'
	}),
	schedule: defineMessage({
		id: 'exams.details.schedule',
		defaultMessage: 'Schedule',
		description: 'Scheduled start and end in the local time zone.'
	}),
	className: defineMessage({
		id: 'exams.details.class',
		defaultMessage: 'Class',
		description: 'Exam class.'
	}),
	unit: defineMessage({
		id: 'exams.details.unit',
		defaultMessage: 'Academic unit',
		description: 'Exam academic unit.'
	}),
	submission: defineMessage({
		id: 'exams.details.submission',
		defaultMessage: 'Submitted',
		description: 'Server-recorded submission timestamp.'
	}),
	resultTitle: defineMessage({
		id: 'exams.result.title',
		defaultMessage: 'Released result',
		description: 'Candidate-facing released remarks.'
	}),
	released: defineMessage({
		id: 'exams.result.released',
		defaultMessage: 'Released {date}',
		description: 'Explicit release date.'
	}),
	noRemarks: defineMessage({
		id: 'exams.result.empty',
		defaultMessage: 'No remarks were included with this result.',
		description: 'Released result with empty candidate remarks.'
	})
};
