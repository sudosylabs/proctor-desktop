/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Proctor contributors. All rights reserved.
 *--------------------------------------------------------------------------------------------*/

import { defineMessage } from '../../../../base/common/localization.js';

/** Text of the Account Profile page and its photo dialog. */
export const profileMessages = Object.freeze({
	notProvided: defineMessage({
		id: 'account.value.not.provided',
		defaultMessage: 'Not provided',
		description: 'An account detail has no value.'
	}),
	changePhoto: defineMessage({
		id: 'account.profile.change.photo',
		defaultMessage: 'Change photo',
		description: 'Choose a new profile photo.'
	}),
	photoZoomValue: defineMessage({
		id: 'account.profile.photo.zoom.value',
		defaultMessage: '{value}%',
		description: 'What the photo zoom slider reports to a screen reader, as in "200%".'
	}),
	addPhoto: defineMessage({
		id: 'account.profile.add.photo',
		defaultMessage: 'Add photo',
		description: 'Choose a profile photo when there is none yet, only initials.'
	}),
	removePhoto: defineMessage({
		id: 'account.profile.remove.photo',
		defaultMessage: 'Remove photo',
		description: 'Remove the profile photo.'
	}),
	photoUnavailable: defineMessage({
		id: 'account.profile.photo.unavailable',
		defaultMessage: 'Your photo couldn’t be loaded, so it can’t be changed right now.',
		description: 'The profile photo read failed.'
	}),
	photoUpdated: defineMessage({
		id: 'account.profile.photo.updated',
		defaultMessage: 'Photo saved.',
		description: 'The profile photo changed.'
	}),
	photoRemoved: defineMessage({
		id: 'account.profile.photo.removed',
		defaultMessage: 'Photo removed.',
		description: 'The profile photo was removed.'
	}),
	confirmRemovePhotoTitle: defineMessage({
		id: 'account.profile.remove.photo.title',
		defaultMessage: 'Remove your photo?',
		description: 'Title of the remove-photo confirmation.'
	}),
	confirmRemovePhotoBody: defineMessage({
		id: 'account.profile.remove.photo.body',
		defaultMessage: 'Your initials are shown instead until you add another photo.',
		description: 'Explains removing the profile photo.'
	}),
	accountDetails: defineMessage({
		id: 'account.profile.details',
		defaultMessage: 'Account details',
		description: 'Heading of the read-only account details.'
	}),
	detailsManaged: defineMessage({
		id: 'account.profile.details.managed',
		defaultMessage: '{institution} manages these. To change one, ask an administrator.',
		description: 'Account details are read-only; institution is its name.'
	}),
	detailsManagedGeneric: defineMessage({
		id: 'account.profile.details.managed.generic',
		defaultMessage: 'Your institution manages these. To change one, ask an administrator.',
		description: 'Account details are read-only and the institution name is unknown.'
	}),
	detailsManagedAdministrator: defineMessage({
		id: 'account.profile.details.managed.administrator',
		defaultMessage: '{institution} manages these. You can change them in Administration.',
		description:
			'Account details, for someone who can open Administration; institution is its name.'
	}),
	detailsManagedAdministratorGeneric: defineMessage({
		id: 'account.profile.details.managed.administrator.generic',
		defaultMessage: 'Your institution manages these. You can change them in Administration.',
		description:
			'Account details, for someone who can open Administration, institution unknown.'
	}),
	editInAdministration: defineMessage({
		id: 'account.profile.edit.in.administration',
		defaultMessage: 'Edit in Administration',
		description:
			'Opens your own person page in Administration, where the details can be changed.'
	}),
	username: defineMessage({
		id: 'account.profile.username',
		defaultMessage: 'Username',
		description: 'Account detail: the name the person signs in with.'
	}),
	firstName: defineMessage({
		id: 'account.profile.first.name',
		defaultMessage: 'First name',
		description: 'Account detail label.'
	}),
	lastName: defineMessage({
		id: 'account.profile.last.name',
		defaultMessage: 'Last name',
		description: 'Account detail label.'
	}),
	email: defineMessage({
		id: 'account.profile.email',
		defaultMessage: 'Email',
		description: 'Account detail label.'
	}),
	emailVerified: defineMessage({
		id: 'account.profile.email.verified',
		defaultMessage: 'Verified',
		description: 'The email address is verified.'
	}),
	emailUnverified: defineMessage({
		id: 'account.profile.email.unverified',
		defaultMessage: 'Not verified',
		description: 'The email address is not verified.'
	}),
	timeZone: defineMessage({
		id: 'account.profile.time.zone',
		defaultMessage: 'Time zone',
		description: 'Account detail label.'
	}),
	memberSince: defineMessage({
		id: 'account.profile.member.since',
		defaultMessage: 'Member since',
		description: 'Account detail label: when the account was created.'
	}),
	lastSignIn: defineMessage({
		id: 'account.profile.last.sign.in',
		defaultMessage: 'Last seen',
		description: 'Account detail label: when the account was last active, here.'
	}),
	lastSignInValue: defineMessage({
		id: 'account.profile.last.sign.in.value',
		defaultMessage: '{when} · {client}',
		description: 'When and with which app the current session signed in.'
	}),
	unverifiedNotice: defineMessage({
		id: 'account.profile.unverified.notice',
		defaultMessage:
			'Your email isn’t verified, so Proctor can’t use it to help you get back into your account.',
		description: 'Explains an unverified email address.'
	}),
	sendVerification: defineMessage({
		id: 'account.profile.send.verification',
		defaultMessage: 'Send verification email',
		description: 'Ask the server to send a verification email.'
	}),
	verificationSent: defineMessage({
		id: 'account.profile.verification.sent',
		defaultMessage: 'If this address can receive email, a verification link is on its way.',
		description: 'Confirms a verification request without revealing delivery.'
	}),
	noAccess: defineMessage({
		id: 'account.profile.no.access',
		defaultMessage: 'You have no assigned access yet. An administrator can give you access.',
		description: 'The account has no assigned access.'
	}),
	noticesTitle: defineMessage({
		id: 'account.profile.notices.title',
		defaultMessage: 'Exam records due for deletion',
		description: 'Heading of the retention notices.'
	}),
	noticesDescription: defineMessage({
		id: 'account.profile.notices.description',
		defaultMessage:
			'{institution} keeps exam records for a set time. These are about to reach it.',
		description: 'Explains retention notices; institution is its name.'
	}),
	noticesDescriptionGeneric: defineMessage({
		id: 'account.profile.notices.description.generic',
		defaultMessage:
			'Your institution keeps exam records for a set time. These are about to reach it.',
		description: 'Explains retention notices when the institution name is unknown.'
	}),
	noticesMore: defineMessage({
		id: 'account.profile.notices.more',
		defaultMessage: 'There are more records than shown here.',
		description: 'The server holds further retention notices.'
	}),
	noticeKind: defineMessage({
		id: 'account.notice.kind',
		defaultMessage: '{category} from the sitting on {date}',
		description:
			'Second line of a retention notice under the exam title: the record kind and the sitting’s start date.'
	}),
	noticeDeletionCanceledUndated: defineMessage({
		id: 'account.notice.deletion.canceled.undated',
		defaultMessage: 'Deletion canceled',
		description: 'A record’s deletion was canceled at an unknown time.'
	}),
	photoDialogTitle: defineMessage({
		id: 'account.photo.dialog.title',
		defaultMessage: 'Change photo',
		description: 'Title of the photo dialog.'
	}),
	photoDialogHelp: defineMessage({
		id: 'account.photo.dialog.help',
		defaultMessage: 'Drag to position it in the circle. Nothing changes until you save.',
		description: 'Explains the photo crop.'
	}),
	photoCropLabel: defineMessage({
		id: 'account.photo.crop.label',
		defaultMessage: 'Photo preview. Use the arrow keys to move the photo in the circle.',
		description: 'Accessible name of the crop area.'
	}),
	photoZoom: defineMessage({
		id: 'account.photo.zoom',
		defaultMessage: 'Zoom',
		description: 'Photo zoom slider label.'
	}),
	photoLowResolution: defineMessage({
		id: 'account.photo.low.resolution',
		defaultMessage: 'This crop is small, so the photo may look blurry.',
		description: 'The crop has fewer pixels than the saved size.'
	}),
	chooseAnother: defineMessage({
		id: 'account.photo.choose.another',
		defaultMessage: 'Choose another',
		description: 'Pick a different image.'
	}),
	savePhoto: defineMessage({
		id: 'account.photo.save',
		defaultMessage: 'Save photo',
		description: 'Save the cropped photo.'
	}),
	photoPreparing: defineMessage({
		id: 'account.photo.preparing',
		defaultMessage: 'Preparing photo…',
		description: 'The image is being decoded.'
	}),
	photoSaving: defineMessage({
		id: 'account.photo.saving',
		defaultMessage: 'Saving photo…',
		description: 'The photo is being uploaded.'
	}),
	photoChecking: defineMessage({
		id: 'account.photo.checking',
		defaultMessage: 'Checking your photo…',
		description: 'Reading the photo after an upload.'
	}),
	photoInvalid: defineMessage({
		id: 'account.photo.invalid',
		defaultMessage: 'Choose a PNG, JPEG or WebP image.',
		description: 'The chosen file is not a usable image.'
	}),
	photoTooLarge: defineMessage({
		id: 'account.photo.too.large',
		defaultMessage:
			'This image is too large to edit safely. Choose an image up to 32 MB and 64 megapixels, with neither side over 16,384 pixels.',
		description: 'The chosen image exceeds local limits.'
	}),
	photoChangedElsewhere: defineMessage({
		id: 'account.photo.changed.elsewhere',
		defaultMessage: 'Your photo was changed somewhere else. Save to replace it with this one.',
		description: 'A newer photo exists; saving again replaces it.'
	}),
	photoCheckAgain: defineMessage({
		id: 'account.photo.check.again',
		defaultMessage: 'Proctor couldn’t confirm the photo. Check again before saving.',
		description: 'The upload outcome is unknown.'
	}),
	photoRecheck: defineMessage({
		id: 'account.photo.recheck',
		defaultMessage: 'Check again',
		description: 'Read the photo again after an unknown outcome.'
	}),
	photoSavedUnconfirmed: defineMessage({
		id: 'account.photo.saved.unconfirmed',
		defaultMessage: 'The photo was saved, but couldn’t be shown yet. Check again.',
		description: 'Upload succeeded but the follow-up read failed.'
	})
});
