import React, { useRef, useEffect } from 'react';
import { View, StyleSheet, Animated, PanResponder, Dimensions, StyleProp, ViewStyle, Platform } from 'react-native';

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

interface DraggableBottomSheetProps {
    children: React.ReactNode;
    header: React.ReactNode;
    /** Middle snap point (default: 45% of screen) */
    midHeight?: number;
    /** Full snap point (default: 90% of screen) */
    fullHeight?: number;
    /** Collapsed snap point (default: 80px) */
    collapsedHeight?: number;
    style?: StyleProp<ViewStyle>;
}

export const DraggableBottomSheet: React.FC<DraggableBottomSheetProps> = ({
    children,
    header,
    midHeight = SCREEN_HEIGHT * 0.45,
    fullHeight = SCREEN_HEIGHT * 0.9,
    collapsedHeight = 80,
    style
}) => {
    // Snap Points (TranslateY)
    // 0 = Full Height (Top)
    // MID_Y = Full - Mid (Middle)
    // COLLAPSED_Y = Full - Collapsed (Bottom)

    const FULL_Y = 0;
    const MID_Y = fullHeight - midHeight;
    const COLLAPSED_Y = fullHeight - collapsedHeight;

    // Start at Middle
    const pan = useRef(new Animated.Value(MID_Y)).current;
    const lastValue = useRef(MID_Y);

    useEffect(() => {
        const id = pan.addListener(({ value }) => {
            lastValue.current = value;
        });
        return () => pan.removeListener(id);
    }, []);

    const panResponder = useRef(
        PanResponder.create({
            onMoveShouldSetPanResponder: (_, gestureState) => {
                return Math.abs(gestureState.dy) > 10;
            },
            onPanResponderGrant: () => {
                pan.setOffset(lastValue.current);
                pan.setValue(0);
            },
            onPanResponderMove: Animated.event(
                [null, { dy: pan }],
                { useNativeDriver: false }
            ),
            onPanResponderRelease: (_, gestureState) => {
                pan.flattenOffset();

                const currentY = lastValue.current;
                let targetY = MID_Y;

                // Velocity check for "flick"
                if (gestureState.vy > 0.5) {
                    // Flipped DOWN (towards bottom)
                    if (currentY < MID_Y) targetY = MID_Y; // From Full/High to Mid
                    else targetY = COLLAPSED_Y; // From Mid/Low to Collapsed
                } else if (gestureState.vy < -0.5) {
                    // Flipped UP (towards top)
                    if (currentY > MID_Y) targetY = MID_Y; // From Collapsed/Low to Mid
                    else targetY = FULL_Y; // From Mid to Full
                } else {
                    // Drag check (nearest neighbor)
                    // We calculate distance to each snap point
                    const distToFull = Math.abs(currentY - FULL_Y);
                    const distToMid = Math.abs(currentY - MID_Y);
                    const distToCollapsed = Math.abs(currentY - COLLAPSED_Y);

                    // Find minimum distance
                    if (distToFull < distToMid && distToFull < distToCollapsed) targetY = FULL_Y;
                    else if (distToCollapsed < distToMid) targetY = COLLAPSED_Y;
                    else targetY = MID_Y;
                }

                // Snap
                Animated.spring(pan, {
                    toValue: targetY,
                    useNativeDriver: false,
                    bounciness: 4
                }).start();
            }
        })
    ).current;

    return (
        <Animated.View
            style={[
                styles.sheetContainer,
                style,
                {
                    height: fullHeight,
                    transform: [{
                        translateY: pan.interpolate({
                            inputRange: [FULL_Y, COLLAPSED_Y],
                            outputRange: [FULL_Y, COLLAPSED_Y],
                            extrapolate: 'clamp'
                        })
                    }]
                }
            ]}
        >
            <View {...panResponder.panHandlers}>
                {header}
            </View>
            {children}
        </Animated.View>
    );
};

const styles = StyleSheet.create({
    sheetContainer: {
        backgroundColor: '#fff',
        borderTopLeftRadius: 24,
        borderTopRightRadius: 24,
        shadowColor: "#000",
        shadowOffset: { width: 0, height: -2 },
        shadowOpacity: 0.1,
        shadowRadius: 8,
        elevation: 5,
        position: 'absolute',
        bottom: 0,
        left: 0,
        right: 0,
    }
});
