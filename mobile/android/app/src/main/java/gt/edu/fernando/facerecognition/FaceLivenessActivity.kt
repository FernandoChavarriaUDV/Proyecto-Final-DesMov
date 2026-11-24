package gt.edu.fernando.facerecognition

import android.app.Activity
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.foundation.layout.*
import androidx.compose.material3.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.amplifyframework.auth.AWSCredentials
import com.amplifyframework.auth.AWSCredentialsProvider
import com.amplifyframework.auth.AuthException
import com.amplifyframework.core.Consumer
import com.amplifyframework.ui.liveness.ui.FaceLivenessDetector
import com.amplifyframework.ui.liveness.ui.LivenessColorScheme
import org.json.JSONObject

class FaceLivenessActivity : ComponentActivity() {
    private var finished = false
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val session = intent.getStringExtra("sessionId")
        val region = intent.getStringExtra("region")
        val raw = intent.getStringExtra("credentials")
        intent.replaceExtras(null as Bundle?)
        // A recreated activity must request a fresh session instead of persisting credentials.
        if (session.isNullOrBlank() || region.isNullOrBlank() || raw.isNullOrBlank() || savedInstanceState != null) {
            failed("Inicie una nueva prueba de vida."); return
        }
        val values = runCatching { JSONObject(raw) }.getOrNull()
        val expiration = values?.optLong("expiresAt", 0L) ?: 0L
        val credentials = values?.let { AWSCredentials.createAWSCredentials(
            it.optString("accessKeyId"), it.optString("secretAccessKey"), it.optString("sessionToken"), expiration / 1000
        ) }
        if (credentials == null || expiration <= System.currentTimeMillis()) {
            failed("Las credenciales temporales vencieron. Inicie otra prueba."); return
        }
        val provider = object : AWSCredentialsProvider<AWSCredentials> {
            override fun fetchAWSCredentials(onSuccess: Consumer<AWSCredentials>, onError: Consumer<AuthException>) {
                if (expiration > System.currentTimeMillis()) onSuccess.accept(credentials)
                else onError.accept(AuthException("Credenciales temporales vencidas.", "Inicie una nueva sesión."))
            }
        }
        setContent {
            MaterialTheme(colorScheme = LivenessColorScheme.default()) {
                Column(Modifier.fillMaxSize().windowInsetsPadding(WindowInsets.safeDrawing)) {
                    Row(Modifier.fillMaxWidth().padding(horizontal = 12.dp), horizontalArrangement = Arrangement.SpaceBetween) {
                        Text("Prueba de vida facial", Modifier.padding(top = 14.dp))
                        TextButton(onClick = { failed("Prueba cancelada.") }) { Text("Cancelar") }
                    }
                    Box(Modifier.weight(1f)) {
                        FaceLivenessDetector(sessionId = session, region = region, credentialsProvider = provider,
                            onComplete = { runOnUiThread { if (!finished) { finished = true; setResult(Activity.RESULT_OK); finish() } } },
                            onError = { failed("No se pudo completar la captura de vida. Revise iluminación y conexión e inicie otra sesión.") })
                    }
                }
            }
        }
    }
    private fun failed(message: String) { runOnUiThread { if (!finished) { finished = true; setResult(Activity.RESULT_CANCELED, Intent().putExtra("message", message)); finish() } } }
}
