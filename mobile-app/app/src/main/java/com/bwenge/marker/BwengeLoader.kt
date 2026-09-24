package com.bwenge.marker

import androidx.compose.animation.core.*
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.*
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.withTransform
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp

@Composable
fun BwengeLoader(
    isOverlay: Boolean = false,
    modifier: Modifier = Modifier
) {
    val duration = if (isOverlay) 6000 else 2400
    val infiniteTransition = rememberInfiniteTransition(label = "BwengeLoader")

    // Animations
    val badgeScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = duration
                1f at (duration * 0.46).toInt() with FastOutSlowInEasing
                0.98f at (duration * 0.63).toInt() with FastOutSlowInEasing
                1.03f at (duration * 0.80).toInt() with FastOutSlowInEasing
                1f at duration with FastOutSlowInEasing
            }
        ), label = "badgeScale"
    )

    val wingOpacity by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = duration
                1f at (duration * 0.46).toInt() with FastOutSlowInEasing
                0.72f at (duration * 0.63).toInt() with FastOutSlowInEasing
                1f at (duration * 0.80).toInt() with FastOutSlowInEasing
            }
        ), label = "wingOpacity"
    )

    val wingScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = duration
                1f at (duration * 0.46).toInt() with FastOutSlowInEasing
                1.04f at (duration * 0.63).toInt() with FastOutSlowInEasing
                1.1f at (duration * 0.80).toInt() with FastOutSlowInEasing
                1f at duration with FastOutSlowInEasing
            }
        ), label = "wingScale"
    )

    val eyeXOffset by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 0f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = duration
                0f at (duration * 0.10).toInt() with LinearEasing
                -14f at (duration * 0.20).toInt() with LinearEasing
                14f at (duration * 0.33).toInt() with LinearEasing
                0f at (duration * 0.46).toInt() with LinearEasing
            }
        ), label = "eyeXOffset"
    )

    val eyeScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = keyframes {
                durationMillis = duration
                1f at (duration * 0.63).toInt()
                1.16f at (duration * 0.80).toInt()
                1f at duration
            }
        ), label = "eyeScale"
    )

    val size = if (isOverlay) 220.dp else 48.dp

    Canvas(modifier = modifier.size(size)) {
        val scaleX = size.toPx() / 680f
        val scaleY = size.toPx() / 340f // Viewbox height was 340 in user SVG snippet, but 680/340 isn't square.
                                         // User used width="32" height="32" for viewBox="0 0 680 340"
                                         // which means it's stretched or letterboxed.
                                         // The original SVG had 220x220 viewBox 0 0 220 220.
                                         // Let's stick to the loader's 680x340 aspect ratio but draw it centered.
        
        val actualScale = Math.min(size.toPx() / 680f, size.toPx() / 340f)
        
        withTransform({
            scale(actualScale, actualScale, Offset.Zero)
            translate((680f - 680f) / 2f, (340f - 340f) / 2f)
        }) {
            // Badge
            withTransform({
                scale(badgeScale, badgeScale, Offset(340f, 170f))
            }) {
                drawCircle(color = Color(0xFF0D2B24), radius = 130f, center = Offset(340f, 170f))
            }

            // Wing
            withTransform({
                scale(wingScale, wingScale, Offset(340f, 170f))
            }) {
                val wingPath = Path().apply {
                    moveTo(281f, 208f)
                    quadraticBezierTo(340f, 273f, 399f, 208f)
                    quadraticBezierTo(399f, 244f, 340f, 268f)
                    quadraticBezierTo(281f, 244f, 281f, 208f)
                    close()
                }
                drawPath(wingPath, color = Color(0xFF9FE1CB), alpha = wingOpacity)
            }

            // Eyes
            withTransform({
                translate(eyeXOffset, 0f)
                scale(eyeScale, eyeScale, Offset(340f, 170f))
            }) {
                // Left Eye
                drawCircle(color = Color(0xFF5DCAA5), radius = 30.7f, center = Offset(302f, 158f))
                drawCircle(color = Color(0xFF0D2B24), radius = 11.8f, center = Offset(302f, 158f))
                
                // Right Eye
                drawCircle(color = Color(0xFF5DCAA5), radius = 30.7f, center = Offset(378f, 158f))
                drawCircle(color = Color(0xFF0D2B24), radius = 11.8f, center = Offset(378f, 158f))
            }
        }
    }
}

@Preview(showBackground = true, backgroundColor = 0xFF121212)
@Composable
fun BwengeLoaderPreview() {
    BwengeLoader(isOverlay = false)
}
