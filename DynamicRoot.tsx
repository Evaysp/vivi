import React from 'react';
import { Composition } from 'remotion';
import { GeneratedComposition } from './compositions/Generated';

export const DynamicRoot: React.FC = () => {
  return (
    <>
      <Composition
        id="GeneratedVideo"
        component={GeneratedComposition}
        durationInFrames={150}
        fps={30}
        width={1280}
        height={720}
        defaultProps={{}}
      />
    </>
  );
};
