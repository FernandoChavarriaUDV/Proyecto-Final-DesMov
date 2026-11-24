package gt.edu.fernando.facerecognition

import android.Manifest
import android.app.Activity
import android.content.Intent
import androidx.activity.result.ActivityResult
import com.getcapacitor.*
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import com.getcapacitor.annotation.ActivityCallback

@CapacitorPlugin(name = "FaceLiveness", permissions = [Permission(alias = "camera", strings = [Manifest.permission.CAMERA])])
class FaceLivenessPlugin : Plugin() {
    @PluginMethod
    fun start(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) {
            requestPermissionForAlias("camera", call, "cameraReady")
        } else launch(call)
    }

    @PermissionCallback
    private fun cameraReady(call: PluginCall) {
        if (getPermissionState("camera") != PermissionState.GRANTED) call.reject("Se requiere permiso de cámara para la prueba de vida.")
        else launch(call)
    }

    private fun launch(call: PluginCall) {
        val sessionId = call.getString("sessionId")
        val region = call.getString("region")
        val credentials = call.getObject("credentials")
        if (sessionId.isNullOrBlank() || region.isNullOrBlank() || credentials == null) {
            call.reject("La sesión de prueba de vida está incompleta."); return
        }
        val intent = Intent(context, FaceLivenessActivity::class.java)
            .putExtra("sessionId", sessionId).putExtra("region", region)
            .putExtra("credentials", credentials.toString())
        startActivityForResult(call, intent, "finished")
    }

    @ActivityCallback
    private fun finished(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        if (result.resultCode == Activity.RESULT_OK) call.resolve(JSObject().put("completed", true))
        else call.reject(result.data?.getStringExtra("message") ?: "Prueba cancelada. Puede iniciar una nueva sesión.")
    }
}
