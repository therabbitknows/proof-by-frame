import React from 'react';
import {useNavigation, useRoute, RouteProp} from '@react-navigation/native';
import {CameraScreen} from './CameraScreen';
import type {RootStackParamList} from '../navigation/RootNavigator';

/**
 * Route-aware wrapper for CameraScreen so the raw component
 * can stay prop-driven and testable in isolation.
 */
export const CameraScreenWrapper: React.FC = () => {
  const navigation = useNavigation<any>();
  const route = useRoute<RouteProp<RootStackParamList, 'Camera'>>();
  const captureMode = route.params?.captureMode ?? 'front';
  const carriedFrontUri = route.params?.frontUri;

  return (
    <CameraScreen
      captureMode={captureMode}
      onCancel={() => navigation.goBack()}
      onCapture={(uri, face) => {
        if (face === 'front') {
          navigation.navigate(
            'Camera' as never,
            {captureMode: 'back', frontUri: uri} as never,
          );
        } else {
          navigation.navigate(
            'Condition' as never,
            {frontUri: carriedFrontUri ?? '', backUri: uri} as never,
          );
        }
      }}
    />
  );
};
