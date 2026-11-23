import { Alert } from 'react-native';

import type { ConfirmDelete } from './confirmDelete.js';

/** The default: a native "Delete message?" alert with Cancel / Delete. */
export const alertConfirmDelete: ConfirmDelete = () =>
  new Promise<boolean>((resolve) => {
    Alert.alert(
      'Delete message?',
      'It will be deleted for everyone.',
      [
        { text: 'Cancel', style: 'cancel', onPress: () => resolve(false) },
        { text: 'Delete', style: 'destructive', onPress: () => resolve(true) },
      ],
      { cancelable: true, onDismiss: () => resolve(false) },
    );
  });
